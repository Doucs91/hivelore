import { describe, expect, it } from "vitest";
import {
  addedLinesFromDiff,
  compileRegexSensor,
  runRegexSensor,
  runSensors,
  sensorAppliesToPath,
  sensorTargetsFromDiff,
} from "../src/sensors.js";
import type { Memory, Sensor } from "../src/types.js";

function sensor(overrides: Partial<Sensor> = {}): Sensor {
  return {
    kind: "regex",
    pattern: "open-in-view",
    paths: [],
    message: "open-in-view was disabled on purpose — do not re-enable it.",
    severity: "warn",
    autogen: false,
    last_fired: null,
    ...overrides,
  };
}

function memory(s: Sensor | undefined, anchorPaths: string[] = []): Memory {
  return {
    frontmatter: {
      id: "2026-05-31-gotcha-open-in-view",
      scope: "team",
      type: "gotcha",
      status: "validated",
      anchor: { paths: anchorPaths, symbols: [] },
      sensor: s,
      tags: [],
      created_at: "2026-05-31T00:00:00.000Z",
      expires_when: null,
      verified_at: null,
      stale_reason: null,
      related_ids: [],
      last_read_at: null,
      revision_count: 0,
      requires_human_approval: false,
    },
    body: "open-in-view is intentionally false.",
  };
}

describe("sensors", () => {
  it("compiles a valid regex sensor and rejects invalid/non-regex ones", () => {
    expect(compileRegexSensor(sensor())).toBeInstanceOf(RegExp);
    expect(compileRegexSensor(sensor({ pattern: "(" }))).toBeNull(); // invalid regex
    expect(compileRegexSensor(sensor({ kind: "shell", command: "x" }))).toBeNull();
    expect(compileRegexSensor(sensor({ pattern: undefined }))).toBeNull();
  });

  it("merges caller flags with the forced multiline flag", () => {
    const re = compileRegexSensor(sensor({ flags: "i" }))!;
    expect(re.flags).toContain("i");
    expect(re.flags).toContain("m");
  });

  it("fires on a matching line and reports the matched content", () => {
    const hit = runRegexSensor("m1", sensor(), {
      path: "src/app.properties",
      content: "spring.jpa.open-in-view=true",
    });
    expect(hit).not.toBeNull();
    expect(hit!.matched_line).toContain("open-in-view");
    expect(hit!.message).toContain("do not re-enable");
    expect(hit!.severity).toBe("warn");
  });

  it("does not fire when the pattern is absent", () => {
    const hit = runRegexSensor("m1", sensor(), {
      path: "src/app.properties",
      content: "spring.jpa.show-sql=true",
    });
    expect(hit).toBeNull();
  });

  it("scopes by sensor paths, falling back to anchor paths", () => {
    const s = sensor({ paths: ["src/backend/"] });
    expect(sensorAppliesToPath(s, [], "src/backend/Repo.java")).toBe(true);
    expect(sensorAppliesToPath(s, [], "src/frontend/App.tsx")).toBe(false);
    expect(sensorAppliesToPath(s, [], "src/other/src/backend/Repo.java")).toBe(false);
    // no sensor paths → fall back to anchor paths
    const s2 = sensor({ paths: [] });
    expect(sensorAppliesToPath(s2, ["config/"], "config/app.yml")).toBe(true);
    expect(sensorAppliesToPath(s2, ["config/"], "src/x.ts")).toBe(false);
    // neither → applies everywhere
    expect(sensorAppliesToPath(sensor({ paths: [] }), [], "anywhere.ts")).toBe(true);
  });

  it("runSensors only runs regex sensors and respects path scope", () => {
    const memos = [
      memory(sensor({ paths: ["src/backend/"] })),
      memory(sensor({ kind: "shell", command: "echo no" })), // skipped
      memory(undefined), // no sensor, skipped
    ];
    const hits = runSensors(memos, [
      { path: "src/backend/App.java", content: "open-in-view=true" },
      { path: "src/frontend/App.tsx", content: "open-in-view=true" },
    ]);
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe("src/backend/App.java");
  });

  it("extracts only added lines from a unified diff", () => {
    const diff = [
      "+++ b/src/app.properties",
      "+spring.jpa.open-in-view=true",
      "-spring.jpa.open-in-view=false",
      " unchanged line",
    ].join("\n");
    const added = addedLinesFromDiff(diff);
    expect(added).toBe("spring.jpa.open-in-view=true");
    // a sensor should fire on the added line, not the removed one
    const hit = runRegexSensor("m1", sensor(), { path: "src/app.properties", content: added });
    expect(hit).not.toBeNull();
  });

  it("splits unified diffs into per-file sensor targets", () => {
    const diff = [
      "diff --git a/src/backend/app.properties b/src/backend/app.properties",
      "--- a/src/backend/app.properties",
      "+++ b/src/backend/app.properties",
      "+spring.jpa.open-in-view=true",
      "diff --git a/src/frontend/App.tsx b/src/frontend/App.tsx",
      "--- a/src/frontend/App.tsx",
      "+++ b/src/frontend/App.tsx",
      "+const flag = 'open-in-view=true';",
    ].join("\n");

    const targets = sensorTargetsFromDiff(diff);
    expect(targets).toEqual([
      { path: "src/backend/app.properties", content: "spring.jpa.open-in-view=true" },
      { path: "src/frontend/App.tsx", content: "const flag = 'open-in-view=true';" },
    ]);

    const hits = runSensors([memory(sensor({ paths: ["src/backend/"] }))], targets);
    expect(hits).toHaveLength(1);
    expect(hits[0].file).toBe("src/backend/app.properties");
  });
});
