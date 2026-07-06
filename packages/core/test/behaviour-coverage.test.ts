import { describe, expect, it } from "vitest";
import { assessBehaviourCoverage, renderBehaviourCoverageLine } from "../src/behaviour-coverage.js";
import type { LoadedMemory } from "../src/loader.js";

function mem(opts: {
  id?: string;
  status?: string;
  type?: "attempt" | "gotcha" | "convention";
  createdAt?: string;
  anchorPaths?: string[];
  sensor?: {
    kind?: "regex" | "ast" | "shell" | "test";
    severity?: "warn" | "block";
    red_proven?: boolean;
    paths?: string[];
  };
}): LoadedMemory {
  return {
    filePath: `/x/${opts.id ?? Math.random()}.md`,
    memory: {
      frontmatter: {
        id: opts.id ?? "m",
        scope: "team",
        type: opts.type ?? "attempt",
        status: opts.status ?? "validated",
        created_at: opts.createdAt ?? "2026-01-01T00:00:00.000Z",
        anchor: { paths: opts.anchorPaths ?? [], symbols: [] },
        sensor: opts.sensor
          ? {
              kind: opts.sensor.kind ?? "test",
              command: "npx vitest run x",
              paths: opts.sensor.paths ?? [],
              message: "m",
              severity: opts.sensor.severity ?? "warn",
              autogen: false,
              last_fired: null,
              red_proven: opts.sensor.red_proven,
            }
          : undefined,
      },
      body: "body",
    },
  } as unknown as LoadedMemory;
}

// Two components, each with >= 3 production files.
const TWO_AREAS = [
  "packages/api/a.ts", "packages/api/b.ts", "packages/api/c.ts",
  "packages/web/x.ts", "packages/web/y.ts", "packages/web/z.ts",
];

describe("assessBehaviourCoverage", () => {
  it("reports zero coverage when there are no command/test sensors", () => {
    const cov = assessBehaviourCoverage({
      memories: [mem({ anchorPaths: ["packages/api/a.ts"], sensor: { kind: "regex" } })],
      codeFiles: TWO_AREAS,
    });
    expect(cov.mainAreas).toEqual(["packages/api", "packages/web"]);
    expect(cov.totalOracles).toBe(0);
    expect(cov.areasWithOracle).toEqual([]);
    expect(cov.uncoveredAreas).toEqual(["packages/api", "packages/web"]);
    expect(renderBehaviourCoverageLine(cov)).toContain("0/2");
  });

  it("credits an oracle to the area of its carrying memory's anchor", () => {
    const cov = assessBehaviourCoverage({
      memories: [
        mem({ id: "o1", anchorPaths: ["packages/api/a.ts"], sensor: { kind: "test", severity: "block", red_proven: true } }),
      ],
      codeFiles: TWO_AREAS,
    });
    expect(cov.totalOracles).toBe(1);
    expect(cov.armedOracles).toBe(1);
    expect(cov.redProvenOracles).toBe(1);
    expect(cov.areasWithOracle).toEqual(["packages/api"]);
    expect(cov.areasWithArmedOracle).toEqual(["packages/api"]);
    expect(cov.areasWithRedProven).toEqual(["packages/api"]);
    expect(cov.uncoveredAreas).toEqual(["packages/web"]);
  });

  it("credits an oracle to areas reached by its sensor scope (incl. globs), not just its anchor", () => {
    const cov = assessBehaviourCoverage({
      memories: [
        mem({ id: "o1", anchorPaths: [], sensor: { kind: "shell", severity: "block", paths: ["packages/web/**"] } }),
      ],
      codeFiles: TWO_AREAS,
    });
    expect(cov.areasWithOracle).toEqual(["packages/web"]);
    expect(cov.oracles[0]!.areas).toEqual(["packages/web"]);
  });

  it("distinguishes armed-but-unproven from armed-and-proven", () => {
    const cov = assessBehaviourCoverage({
      memories: [
        mem({ id: "armed", anchorPaths: ["packages/api/a.ts"], sensor: { kind: "test", severity: "block", red_proven: false } }),
        mem({ id: "warn", anchorPaths: ["packages/web/x.ts"], sensor: { kind: "test", severity: "warn" } }),
      ],
      codeFiles: TWO_AREAS,
    });
    expect(cov.totalOracles).toBe(2);
    expect(cov.armedOracles).toBe(1);
    expect(cov.redProvenOracles).toBe(0);
    expect(cov.areasWithOracle.sort()).toEqual(["packages/api", "packages/web"]);
    expect(cov.areasWithArmedOracle).toEqual(["packages/api"]);
    expect(cov.areasWithRedProven).toEqual([]);
  });

  it("ignores rejected/draft oracle memories", () => {
    const cov = assessBehaviourCoverage({
      memories: [
        mem({ id: "rej", status: "rejected", anchorPaths: ["packages/api/a.ts"], sensor: { kind: "test", severity: "block" } }),
        mem({ id: "draft", status: "draft", anchorPaths: ["packages/web/x.ts"], sensor: { kind: "test", severity: "block" } }),
      ],
      codeFiles: TWO_AREAS,
    });
    expect(cov.totalOracles).toBe(0);
  });

  it("suggests a scaffoldable lesson per uncovered area (prefers attempt, then most recent)", () => {
    const cov = assessBehaviourCoverage({
      memories: [
        // web is covered by an oracle → not a suggestion target
        mem({ id: "web-oracle", anchorPaths: ["packages/web/x.ts"], sensor: { kind: "test", severity: "block" } }),
        // api is uncovered but has scaffoldable lessons: a gotcha and a newer attempt → prefer the attempt
        mem({ id: "api-gotcha", type: "gotcha", anchorPaths: ["packages/api/a.ts"], createdAt: "2026-02-01T00:00:00.000Z" }),
        mem({ id: "api-attempt", type: "attempt", anchorPaths: ["packages/api/b.ts"], createdAt: "2026-01-01T00:00:00.000Z" }),
      ],
      codeFiles: TWO_AREAS,
    });
    expect(cov.uncoveredAreas).toEqual(["packages/api"]);
    const apiSuggestion = cov.uncoveredAreaSuggestions.find((s) => s.area === "packages/api");
    expect(apiSuggestion?.candidateLessonId).toBe("api-attempt");
  });

  it("marks an uncovered area with no lesson as having no candidate", () => {
    const cov = assessBehaviourCoverage({
      memories: [mem({ id: "web-oracle", anchorPaths: ["packages/web/x.ts"], sensor: { kind: "test", severity: "block" } })],
      codeFiles: TWO_AREAS,
    });
    const apiSuggestion = cov.uncoveredAreaSuggestions.find((s) => s.area === "packages/api");
    expect(apiSuggestion).toBeDefined();
    expect(apiSuggestion?.candidateLessonId).toBeUndefined();
  });

  it("does not offer a lesson that is already a behavioural oracle as a suggestion", () => {
    const cov = assessBehaviourCoverage({
      memories: [
        // this attempt already carries a test oracle → it covers api, so api is not uncovered
        mem({ id: "api-oracle", type: "attempt", anchorPaths: ["packages/api/a.ts"], sensor: { kind: "test", severity: "warn" } }),
      ],
      codeFiles: TWO_AREAS,
    });
    expect(cov.uncoveredAreas).toEqual(["packages/web"]);
    const web = cov.uncoveredAreaSuggestions.find((s) => s.area === "packages/web");
    expect(web?.candidateLessonId).toBeUndefined();
  });

  it("returns no areas when the code-map has no production files", () => {
    const cov = assessBehaviourCoverage({ memories: [], codeFiles: ["src/x.test.ts", "vitest.config.ts"] });
    expect(cov.mainAreas).toEqual([]);
    expect(renderBehaviourCoverageLine(cov)).toBe("no main code areas detected");
  });
});
