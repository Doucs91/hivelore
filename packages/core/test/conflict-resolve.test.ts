import { describe, expect, it } from "vitest";
import type { LoadedMemory } from "../src/loader.js";
import type { MemoryFrontmatter } from "../src/types.js";
import { applyConflictResolution, planConflictResolution } from "../src/conflict-resolve.js";

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

describe("applyConflictResolution (guided supersede → topic-upsert / revision_count)", () => {
  const now = new Date("2026-06-10T00:00:00.000Z");

  it("promotes the winner (revision++, verified, linked) and deprecates the loser", () => {
    const winner = mem("b", { status: "validated", revision_count: 2 });
    const loser = mem("a", { status: "rejected" });
    const plan = planConflictResolution(loser, winner);
    const out = applyConflictResolution(winner, loser, plan, now);

    expect(out.winner.revision_count).toBe(3);
    expect(out.winner.verified_at).toBe(now.toISOString());
    expect(out.winner.related_ids).toContain("a");
    expect(out.loser.status).toBe("deprecated");
    expect(out.loser.stale_reason).toContain("Superseded by b");
    expect(out.loser.related_ids).toContain("b");
  });

  it("winner adopts the loser's topic when it has none (future captures consolidate)", () => {
    const winner = mem("b", { status: "validated" });
    const loser = mem("a", { status: "rejected", topic: "db-pooling" });
    const plan = planConflictResolution(loser, winner);
    const out = applyConflictResolution(winner, loser, plan, now);
    expect(out.topic).toBe("db-pooling");
    expect(out.topic_adopted).toBe(true);
    expect(out.winner.topic).toBe("db-pooling");
  });

  it("never overwrites an existing winner topic", () => {
    const winner = mem("b", { status: "validated", topic: "keep-me" });
    const loser = mem("a", { status: "rejected", topic: "drop-me" });
    const plan = planConflictResolution(loser, winner);
    const out = applyConflictResolution(winner, loser, plan, now);
    expect(out.topic).toBe("keep-me");
    expect(out.topic_adopted).toBe(false);
  });
});
