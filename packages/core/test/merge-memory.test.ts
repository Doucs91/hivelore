import { describe, expect, it } from "vitest";
import { serializeMemory } from "../src/parser.js";
import { mergeMemoryVersions } from "../src/merge-memory.js";
import type { MemoryFrontmatter } from "../src/types.js";

function content(extras: Partial<MemoryFrontmatter>, body = "# Recap\nbody"): string {
  const frontmatter: MemoryFrontmatter = {
    id: "2026-06-01-session_recap-recap",
    scope: "personal",
    type: "session_recap",
    status: "validated",
    anchor: { paths: [], symbols: [] },
    tags: [],
    created_at: "2026-06-01T00:00:00.000Z",
    expires_when: null,
    verified_at: null,
    stale_reason: null,
    related_ids: [],
    last_read_at: null,
    requires_human_approval: false,
    revision_count: 0,
    ...extras,
  };
  return serializeMemory({ frontmatter, body });
}

describe("mergeMemoryVersions", () => {
  it("returns ours when identical", () => {
    const x = content({});
    const r = mergeMemoryVersions(x, x);
    expect(r.winner).toBe("ours");
    expect(r.reason).toBe("identical");
  });

  it("higher revision_count wins", () => {
    const ours = content({ revision_count: 3 });
    const theirs = content({ revision_count: 7 });
    const r = mergeMemoryVersions(ours, theirs);
    expect(r.winner).toBe("theirs");
    expect(r.content).toBe(theirs);
    expect(r.reason).toContain("revision_count");
  });

  it("newer created_at wins when revision ties", () => {
    const ours = content({ created_at: "2026-06-01T00:00:00.000Z" });
    const theirs = content({ created_at: "2026-06-02T00:00:00.000Z" });
    const r = mergeMemoryVersions(ours, theirs);
    expect(r.winner).toBe("theirs");
    expect(r.reason).toContain("newer");
  });

  it("falls back to ours on an unparseable side (never throws)", () => {
    const ours = content({ revision_count: 1 });
    const r = mergeMemoryVersions(ours, "this is not a memory file <<<<<<<");
    expect(r.winner).toBe("ours");
    expect(r.content).toBe(ours);
  });
});
