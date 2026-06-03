import { describe, expect, it } from "vitest";
import type { LoadedMemory } from "../src/loader.js";
import type { MemoryFrontmatter } from "../src/types.js";
import { planConflictResolution } from "../src/conflict-resolve.js";

function mem(
  id: string,
  extras: Partial<MemoryFrontmatter> = {},
): LoadedMemory {
  return {
    filePath: `/mock/${id}.md`,
    memory: {
      frontmatter: {
        id,
        scope: "team",
        type: "decision",
        status: "validated",
        anchor: { paths: [], symbols: [] },
        tags: [],
        created_at: "2026-05-01T00:00:00.000Z",
        expires_when: null,
        verified_at: null,
        stale_reason: null,
        related_ids: [],
        last_read_at: null,
        requires_human_approval: false,
        revision_count: 0,
        ...extras,
      },
      body: "# x",
    },
  };
}

describe("planConflictResolution", () => {
  it("validated beats rejected", () => {
    const r = planConflictResolution(mem("a", { status: "rejected" }), mem("b", { status: "validated" }));
    expect(r.keep_id).toBe("b");
    expect(r.supersede_id).toBe("a");
    expect(r.reason).toContain("status");
  });

  it("higher revision_count wins when status ties", () => {
    const r = planConflictResolution(mem("a", { revision_count: 1 }), mem("b", { revision_count: 5 }));
    expect(r.keep_id).toBe("b");
    expect(r.reason).toContain("revision_count");
  });

  it("newer created_at wins when status and revision tie", () => {
    const r = planConflictResolution(
      mem("a", { created_at: "2026-05-01T00:00:00.000Z" }),
      mem("b", { created_at: "2026-06-01T00:00:00.000Z" }),
    );
    expect(r.keep_id).toBe("b");
    expect(r.reason).toContain("recency");
    expect(r.stale_reason).toContain("Superseded by b");
  });
});
