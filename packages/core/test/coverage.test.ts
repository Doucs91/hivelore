import { describe, expect, it } from "vitest";
import type { LoadedMemory } from "../src/loader.js";
import type { MemoryFrontmatter } from "../src/types.js";
import { buildCoverageIndex, findCoverageGaps, isCovered } from "../src/coverage.js";

function mem(id: string, type: string, paths: string[], status = "validated"): LoadedMemory {
  return {
    filePath: `/mock/${id}.md`,
    memory: {
      frontmatter: {
        id,
        scope: "team",
        type: type as MemoryFrontmatter["type"],
        status: status as MemoryFrontmatter["status"],
        anchor: { paths, symbols: [] },
        tags: [],
        created_at: "2026-05-01T00:00:00.000Z",
        expires_when: null,
        verified_at: null,
        stale_reason: null,
        related_ids: [],
        last_read_at: null,
        requires_human_approval: false,
        revision_count: 0,
      },
      body: "# x",
    },
  };
}

describe("coverage", () => {
  it("covers a file by exact anchor and by directory prefix", () => {
    const cov = buildCoverageIndex([mem("a", "decision", ["src/pay/Service.ts"]), mem("b", "convention", ["src/auth/"])]);
    expect(isCovered("src/pay/Service.ts", cov)).toBe(true);
    expect(isCovered("src/auth/login.ts", cov)).toBe(true);
    expect(isCovered("src/other/x.ts", cov)).toBe(false);
  });

  it("ignores non-covering types and dead memories", () => {
    const cov = buildCoverageIndex([
      mem("recap", "session_recap", ["src/hot.ts"]),
      mem("dead", "decision", ["src/dead.ts"], "deprecated"),
    ]);
    expect(isCovered("src/hot.ts", cov)).toBe(false);
    expect(isCovered("src/dead.ts", cov)).toBe(false);
  });

  it("flags uncovered hot files above the change threshold, hottest first", () => {
    const memories = [mem("a", "decision", ["src/covered.ts"])];
    const hot = [
      { path: "src/covered.ts", changes: 10 },
      { path: "src/blind.ts", changes: 8 },
      { path: "src/cold.ts", changes: 1 },
      { path: "src/blind2.ts", changes: 5 },
    ];
    const gaps = findCoverageGaps(hot, memories, { minChanges: 3 });
    expect(gaps.map((g) => g.path)).toEqual(["src/blind.ts", "src/blind2.ts"]);
  });

  it("respects the limit", () => {
    const hot = Array.from({ length: 30 }, (_, i) => ({ path: `src/f${i}.ts`, changes: 5 }));
    expect(findCoverageGaps(hot, [], { limit: 5 }).length).toBe(5);
  });
});
