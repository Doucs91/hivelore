import { describe, expect, it } from "vitest";
import type { LoadedMemory } from "../src/loader.js";
import type { MemoryFrontmatter } from "../src/types.js";
import {
  findLexicalConflictPairs,
  findTopicStatusConflictPairs,
} from "../src/conflict-candidates.js";

function mem(
  id: string,
  type: string,
  body: string,
  createdDaysAgo = 1,
  extras?: Partial<MemoryFrontmatter>,
): LoadedMemory {
  const at = new Date(Date.now() - createdDaysAgo * 86_400_000).toISOString();
  return {
    filePath: `/mock/${id}.md`,
    memory: {
      frontmatter: {
        id,
        scope: "team",
        type: type as MemoryFrontmatter["type"],
        status: "validated",
        anchor: { paths: [], symbols: [] },
        tags: [],
        created_at: at,
        expires_when: null,
        verified_at: null,
        stale_reason: null,
        related_ids: [],
        last_read_at: null,
        requires_human_approval: false,
        revision_count: 0,
        ...extras,
      },
      body: `# Title\n${body}`,
    },
  };
}

describe("findTopicStatusConflictPairs", () => {
  it("pairs validated vs rejected on same topic", () => {
    const a = mem("x1", "decision", "A", 1, {
      topic: "decision/foo",
      status: "validated",
    });
    const b = mem("x2", "decision", "B", 1, {
      topic: "decision/foo",
      status: "rejected",
    });
    const p = findTopicStatusConflictPairs([a, b], 10);
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(p[0]!.topic).toBe("decision/foo");
  });
});

describe("findLexicalConflictPairs", () => {
  it("surfaces lexically overlapping decision pairs", () => {
    const all = [
      mem("d1", "decision", "We must never use Redux in dashboards"),
      mem("d2", "decision", "Avoid Redux entirely for dashboard code"),
      mem("d3", "decision", "Unrelated bananas"),
    ];
    const { pairs, scanned } = findLexicalConflictPairs(all, {
      sinceDays: 30,
      types: ["decision"],
      minJaccard: 0.1,
      maxPairs: 10,
      maxScan: 100,
    });
    expect(scanned).toBe(3);
    expect(
      pairs.some(
        (p) =>
          (p.id_a === "d1" && p.id_b === "d2") || (p.id_a === "d2" && p.id_b === "d1"),
      ),
    ).toBe(true);
  });
});
