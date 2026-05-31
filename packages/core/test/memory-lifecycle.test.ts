import { describe, expect, it } from "vitest";
import { retirementSignal } from "../src/memory-lifecycle.js";
import type { MemoryFrontmatter } from "../src/types.js";

function fm(overrides: Partial<MemoryFrontmatter> = {}): MemoryFrontmatter {
  return {
    id: "2026-05-31-attempt-old-flag",
    scope: "team",
    type: "attempt",
    status: "validated",
    anchor: { paths: [], symbols: [] },
    tags: [],
    created_at: "2026-05-01T00:00:00.000Z",
    expires_when: null,
    verified_at: null,
    stale_reason: null,
    related_ids: [],
    last_read_at: null,
    revision_count: 0,
    requires_human_approval: false,
    ...overrides,
  };
}

describe("memory lifecycle", () => {
  it("retires records after expires_when", () => {
    const signal = retirementSignal(
      fm({ expires_when: "2026-05-30T00:00:00.000Z" }),
      "",
      new Date("2026-05-31T00:00:00.000Z"),
    );
    expect(signal.retired).toBe(true);
    expect(signal.reason).toContain("expired");
  });

  it("retires records tagged as obsolete or superseded", () => {
    expect(retirementSignal(fm({ tags: ["obsolete"] })).retired).toBe(true);
    expect(retirementSignal(fm({ tags: ["superseded"] })).retired).toBe(true);
  });

  it("does not retire fixed tags by themselves because they may be regression guards", () => {
    expect(retirementSignal(fm({ tags: ["fixed"] }), "# Fixed bug\n\nKeep this gotcha active.").retired).toBe(false);
  });

  it("retires bodies with explicit fixed/superseded wording", () => {
    const signal = retirementSignal(fm(), "# Old flag\n\nFixed in 0.10.0; kept only for audit history.");
    expect(signal.retired).toBe(true);
    expect(signal.reason).toContain("fixed");
  });

  it("does not retire ordinary active memories", () => {
    expect(retirementSignal(fm(), "# Current rule\n\nUse AC-100007 public ids.").retired).toBe(false);
  });
});
