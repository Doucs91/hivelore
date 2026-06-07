import { describe, expect, it } from "vitest";
import {
  addedLinesFromDiff,
  compileRegexSensor,
  extractSensorExamples,
  judgeProposedSensor,
  runRegexSensor,
  runSensors,
  selectCommandSensors,
  sensorAppliesToPath,
  sensorPatternBrittleness,
  sensorSelfCheck,
  sensorTargetsFromDiff,
} from "../src/sensors.js";
import type { Memory, Sensor } from "../src/types.js";

describe("sensorPatternBrittleness", () => {
  it("flags hardcoded line ranges and numeric literals (they rot when code shifts)", () => {
    expect(sensorPatternBrittleness("enforce\\.ts\\s*:\\s*1131-1186")).toMatch(/line\/number range/);
    expect(sensorPatternBrittleness("foo:\\s*1131")).toMatch(/numeric literal/);
  });

  it("does NOT flag durable patterns that generalize (digits inside classes/quantifiers)", () => {
    expect(sensorPatternBrittleness(":\\s*any\\b")).toBeNull();
    expect(sensorPatternBrittleness("v[0-9]+\\.[0-9]+\\.[0-9]+")).toBeNull();
    expect(sensorPatternBrittleness("DEBUG\\s*=\\s*True")).toBeNull();
    expect(sensorPatternBrittleness("antiPatternGate\\s*[:=]\\s*['\"]off['\"]")).toBeNull();
  });
});

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

  it("downgrades a brittle block sensor to warn at match time (never hard-blocks)", () => {
    const brittle = sensor({ pattern: "enforce\\.ts\\s*:\\s*1131-1186", severity: "block" });
    const hit = runRegexSensor("m1", brittle, { path: "x.ts", content: "see enforce.ts: 1131-1186 here" });
    expect(hit).not.toBeNull();
    expect(hit!.severity).toBe("warn"); // brittle pattern can't hard-block even when promoted

    // A durable block sensor keeps its block severity.
    const durable = sensor({ pattern: "open-in-view", severity: "block" });
    const ok = runRegexSensor("m1", durable, { path: "a.properties", content: "open-in-view=true" });
    expect(ok!.severity).toBe("block");
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

  it("selectCommandSensors picks shell/test sensors applicable to changed paths", () => {
    const shell = memory(
      sensor({ kind: "shell", command: "npm run lint", pattern: undefined, paths: ["src/backend/"] }),
    );
    const test = memory(
      sensor({ kind: "test", command: "npm test -- cycle", pattern: undefined, paths: ["src/core/"] }),
    );
    const regex = memory(sensor()); // regex → never selected as a command sensor
    const noCommand = memory(sensor({ kind: "shell", command: "  ", pattern: undefined }));

    const specs = selectCommandSensors([shell, test, regex, noCommand], ["src/backend/Repo.java"]);
    expect(specs).toHaveLength(1);
    expect(specs[0]!.command).toBe("npm run lint");
    expect(specs[0]!.kind).toBe("shell");

    // no changed paths → apply unconditionally (both command sensors selected)
    expect(selectCommandSensors([shell, test], []).map((s) => s.kind).sort()).toEqual(["shell", "test"]);
  });
});

describe("discriminating sensors (absent / correct-usage marker)", () => {
  const discriminating: Sensor = {
    kind: "regex",
    pattern: "stripe\\.paymentIntents\\.create",
    absent: "idempotencyKey",
    paths: ["src/payments/stripe.ts"],
    message: "stripe.paymentIntents.create without idempotencyKey",
    severity: "block",
    autogen: true,
    last_fired: null,
  };

  it("fires on the faulty call (trigger present, companion absent)", () => {
    const hit = runRegexSensor("m1", discriminating, {
      path: "src/payments/stripe.ts",
      content: "return stripe.paymentIntents.create({ amount, currency: 'usd' });",
    });
    expect(hit).not.toBeNull();
    expect(hit?.severity).toBe("block");
  });

  it("suppresses the correct call (companion within the window, multi-line)", () => {
    const content = [
      "return stripe.paymentIntents.create(",
      "  { amount, currency: 'usd' },",
      "  { idempotencyKey },",
      ");",
    ].join("\n");
    expect(runRegexSensor("m1", discriminating, { path: "src/payments/stripe.ts", content })).toBeNull();
  });

  it("a correct function directly above a faulty one does NOT mask it (real adjacent layout)", () => {
    // Reproduces the live failure: a symmetric window let goodRefund's idempotencyKey leak down into
    // badRefund's window. The forward-biased window must fire on badRefund anyway.
    const content = [
      "export async function goodRefund(a: number, k: string) {",
      "  return stripe.paymentIntents.create(",
      "    { amount: a, currency: 'usd' },",
      "    { idempotencyKey: k },",
      "  );",
      "}",
      "",
      "export async function badRefund(a: number) {",
      "  return stripe.paymentIntents.create({ amount: a, currency: 'usd' });",
      "}",
    ].join("\n");
    const hit = runRegexSensor("m1", discriminating, { path: "src/payments/stripe.ts", content });
    expect(hit).not.toBeNull();
    expect(hit?.matched_line).toContain("create");
    expect(hit?.matched_line).not.toContain("idempotencyKey");
  });

  it("a hoisted options object on the line just above is still recognized (short lookback)", () => {
    const content = [
      "const opts = { idempotencyKey };",
      "return stripe.paymentIntents.create(args, opts);",
    ].join("\n");
    expect(runRegexSensor("m1", discriminating, { path: "src/payments/stripe.ts", content })).toBeNull();
  });

  it("a sensor without `absent` still fires on every match (back-compat)", () => {
    const plain: Sensor = { ...discriminating, absent: undefined };
    const content = "stripe.paymentIntents.create({ a }, { idempotencyKey });";
    expect(runRegexSensor("m1", plain, { path: "src/payments/stripe.ts", content })).not.toBeNull();
  });
});

describe("sensorSelfCheck (must discriminate before it can block)", () => {
  const discriminating: Sensor = {
    kind: "regex",
    pattern: "stripe\\.paymentIntents\\.create",
    absent: "idempotencyKey",
    paths: ["src/payments/stripe.ts"],
    message: "create without idempotencyKey",
    severity: "block",
    autogen: true,
    last_fired: null,
  };

  it("passes: silent on correct current code, fires on the bad example", () => {
    const check = sensorSelfCheck(discriminating, {
      currentTargets: [{
        path: "src/payments/stripe.ts",
        content: "return stripe.paymentIntents.create({ a }, { idempotencyKey });",
      }],
      badExamples: ["stripe.paymentIntents.create({ amount: 1 });"],
    });
    expect(check.silent_on_current).toBe(true);
    expect(check.fires_on_bad).toBe(true);
    expect(check.passed).toBe(true);
    expect(check.fired_on).toEqual([]);
  });

  it("fails: a broad sensor fires on the current (correct) code → false-positive risk", () => {
    const broad: Sensor = { ...discriminating, absent: undefined };
    const check = sensorSelfCheck(broad, {
      currentTargets: [{
        path: "src/payments/stripe.ts",
        content: "return stripe.paymentIntents.create({ a }, { idempotencyKey });",
      }],
      badExamples: [],
    });
    expect(check.silent_on_current).toBe(false);
    expect(check.fired_on).toEqual(["src/payments/stripe.ts"]);
    expect(check.passed).toBe(false);
  });

  it("fires_on_bad is null when no example is available; passed mirrors silent_on_current", () => {
    const check = sensorSelfCheck(discriminating, {
      currentTargets: [{ path: "src/payments/stripe.ts", content: "const x = 1;" }],
      badExamples: [],
    });
    expect(check.fires_on_bad).toBeNull();
    expect(check.passed).toBe(true);
  });

  it("fails when it cannot fire on the documented bad example", () => {
    const check = sensorSelfCheck(discriminating, {
      currentTargets: [],
      badExamples: ["totally unrelated code"],
    });
    expect(check.fires_on_bad).toBe(false);
    expect(check.passed).toBe(false);
  });
});

describe("judgeProposedSensor (agent proposes, core validates)", () => {
  const base: Sensor = {
    kind: "regex",
    pattern: "stripe\\.paymentIntents\\.create",
    absent: "idempotencyKey",
    paths: ["src/payments/stripe.ts"],
    message: "create without idempotencyKey",
    severity: "block",
    autogen: false,
    last_fired: null,
  };
  const correct = { path: "src/payments/stripe.ts", content: "create stripe.paymentIntents.create({ a }, { idempotencyKey });" };

  it("accepts a discriminating block sensor: silent on current, fires on the bad example", () => {
    const v = judgeProposedSensor(base, { currentTargets: [correct], badExamples: ["stripe.paymentIntents.create({ a });"] });
    expect(v.accepted).toBe(true);
  });

  it("rejects a block sensor that fires on the current correct code", () => {
    const broad: Sensor = { ...base, absent: undefined };
    const v = judgeProposedSensor(broad, { currentTargets: [correct], badExamples: [] });
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe("fires-on-current");
  });

  it("rejects a brittle block sensor", () => {
    const brittle: Sensor = { ...base, pattern: "foo:1131-1186", absent: undefined };
    const v = judgeProposedSensor(brittle, { currentTargets: [], badExamples: [] });
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe("brittle");
  });

  it("rejects a block sensor that misses the documented bad example", () => {
    const v = judgeProposedSensor(base, { currentTargets: [], badExamples: ["unrelated code"] });
    expect(v.accepted).toBe(false);
    expect(v.reason).toBe("missed-bad-example");
  });

  it("always accepts a warn sensor (advisory), even if it fires on current code", () => {
    const warn: Sensor = { ...base, absent: undefined, severity: "warn" };
    const v = judgeProposedSensor(warn, { currentTargets: [correct], badExamples: [] });
    expect(v.accepted).toBe(true);
  });
});

describe("extractSensorExamples", () => {
  it("pulls fenced code blocks and code-like inline spans, ignoring prose backticks", () => {
    const body = [
      "# Bad",
      "```ts",
      "stripe.paymentIntents.create({ a });",
      "```",
      "Avoid calling `create()` here; the word `idempotency` alone is prose.",
    ].join("\n");
    const examples = extractSensorExamples(body);
    expect(examples.some((e) => e.includes("paymentIntents.create"))).toBe(true);
    expect(examples).toContain("create()");
    expect(examples).not.toContain("idempotency");
  });
});
