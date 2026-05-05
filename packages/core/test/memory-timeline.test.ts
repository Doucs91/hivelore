import { describe, expect, it } from "vitest";
import type { LoadedMemory } from "../src/loader.js";
import { collectTimelineEntries } from "../src/memory-timeline.js";

function mem(
  id: string,
  topic: string | undefined,
  related: string[],
  paths: string[],
  iso: string,
): LoadedMemory {
  return {
    filePath: `/${id}.md`,
    memory: {
      frontmatter: {
        id,
        scope: "team",
        type: "decision",
        status: "validated",
        anchor: { paths, symbols: [] },
        tags: [],
        created_at: iso,
        expires_when: null,
        verified_at: null,
        stale_reason: null,
        related_ids: related,
        last_read_at: null,
        requires_human_approval: false,
        revision_count: 0,
        ...(topic ? { topic } : {}),
      },
      body: `# ${id} title`,
    },
  };
}

describe("collectTimelineEntries", () => {
  it("filters by topic only", () => {
    const all = [
      mem("a", "payments/foo", [], [], "2026-02-02T00:00:00.000Z"),
      mem("b", "payments/foo", [], [], "2026-01-02T00:00:00.000Z"),
      mem("c", "auth/bar", [], [], "2026-01-03T00:00:00.000Z"),
    ];
    const { entries } = collectTimelineEntries(all, { topic: "payments/foo", limit: 10 });
    expect(entries.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("expands seed by related_ids and overlapping paths", () => {
    const all = [
      mem("seed", undefined, ["r2"], ["src/a.ts"], "2026-01-05T00:00:00.000Z"),
      mem("r2", undefined, [], ["src/a.ts"], "2026-01-06T00:00:00.000Z"),
      mem("neighbor", undefined, [], ["src/a.ts"], "2026-01-07T00:00:00.000Z"),
      mem("far", undefined, [], ["src/b.ts"], "2026-01-08T00:00:00.000Z"),
    ];
    const { entries } = collectTimelineEntries(all, {
      memoryId: "seed",
      limit: 20,
    });
    const ids = new Set(entries.map((e) => e.id));
    expect(ids.has("seed")).toBe(true);
    expect(ids.has("r2")).toBe(true);
    expect(ids.has("neighbor")).toBe(true);
    expect(ids.has("far")).toBe(false);
  });
});
