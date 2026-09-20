import { describe, expect, it } from "vitest";
import { deriveConfidence, isAutoPromoteEligible } from "../src/confidence.js";
import { buildFrontmatter } from "../src/parser.js";
import { emptyUsage, type MemoryUsage } from "../src/usage.js";
import type { MemoryFrontmatter } from "../src/types.js";

function fm(status: MemoryFrontmatter["status"]): MemoryFrontmatter {
  return { ...buildFrontmatter({ type: "convention", slug: "x" }), status };
}

function usage(overrides: Partial<MemoryUsage> = {}): MemoryUsage {
  return { ...emptyUsage(), ...overrides };
}

describe("deriveConfidence", () => {
  it("draft → unverified", () => {
    expect(deriveConfidence(fm("draft"), usage())).toBe("unverified");
  });

  it("stale → stale", () => {
    expect(deriveConfidence(fm("stale"), usage({ read_count: 100 }))).toBe("stale");
  });

  it("deprecated → stale (treat both as untrustworthy)", () => {
    expect(deriveConfidence(fm("deprecated"), usage())).toBe("stale");
  });

  it("proposed with no reads → low", () => {
    expect(deriveConfidence(fm("proposed"), usage())).toBe("low");
  });

  it("proposed stays low despite repeated exposure", () => {
    expect(deriveConfidence(fm("proposed"), usage({ read_count: 300 }))).toBe("low");
  });

  it("validated with low reads → trusted", () => {
    expect(deriveConfidence(fm("validated"), usage({ read_count: 1 }))).toBe("trusted");
  });

  it("validated exposure alone never becomes authoritative", () => {
    expect(deriveConfidence(fm("validated"), usage({ read_count: 1000 }))).toBe("trusted");
  });
});

describe("deriveConfidence — time decay", () => {
  const FRESH = new Date("2026-05-02T00:00:00Z");

  it("a freshly created authoritative memory stays authoritative", () => {
    const f = { ...fm("validated"), validated_by: "human" as const, evidence: "tested" as const, verified_at: "2026-05-01T00:00:00Z", created_at: "2026-05-01T00:00:00Z" };
    expect(deriveConfidence(f, usage({ read_count: 50, last_read_at: "2026-05-01T00:00:00Z" }), undefined, FRESH))
      .toBe("authoritative");
  });

  it("authoritative not verified in 200 days drops to trusted (decayDays=180 default)", () => {
    const f = { ...fm("validated"), validated_by: "human" as const, evidence: "tested" as const, verified_at: "2025-10-01T00:00:00Z", created_at: "2025-10-01T00:00:00Z" };
    expect(
      deriveConfidence(f, usage({ read_count: 50, last_read_at: "2025-10-01T00:00:00Z" }), undefined, FRESH),
    ).toBe("trusted");
  });

  it("authoritative not verified in 400 days hard-decays to low", () => {
    const f = { ...fm("validated"), created_at: "2025-03-01T00:00:00Z" };
    expect(
      deriveConfidence(f, usage({ read_count: 50, last_read_at: "2025-03-01T00:00:00Z" }), undefined, FRESH),
    ).toBe("low");
  });

  it("trusted not verified in 200 days drops to low (one tier)", () => {
    const f = { ...fm("validated"), created_at: "2025-10-01T00:00:00Z" };
    expect(
      deriveConfidence(f, usage({ read_count: 1, last_read_at: "2025-10-01T00:00:00Z" }), undefined, FRESH),
    ).toBe("low");
  });

  it("repeated retrieval cannot refresh an old claim", () => {
    const f = { ...fm("validated"), created_at: "2025-01-01T00:00:00Z" };
    // Fresh retrieval does not reset the verification clock.
    expect(
      deriveConfidence(f, usage({ read_count: 50, last_read_at: "2026-04-01T00:00:00Z" }), undefined, FRESH),
    ).toBe("low");
  });

  it("draft / unverified are not decayed (already at the floor)", () => {
    const f = { ...fm("draft"), created_at: "2024-01-01T00:00:00Z" };
    expect(deriveConfidence(f, usage(), undefined, FRESH)).toBe("unverified");
  });
});

describe("isAutoPromoteEligible", () => {
  it("only proposed can be auto-promoted", () => {
    expect(isAutoPromoteEligible(fm("draft"), usage({ read_count: 99 }))).toBe(false);
    expect(isAutoPromoteEligible(fm("validated"), usage({ read_count: 99 }))).toBe(false);
  });

  it("requires confirmed applications, not reads", () => {
    expect(isAutoPromoteEligible(fm("proposed"), usage({ read_count: 100, applied_count: 4 }))).toBe(false);
    expect(isAutoPromoteEligible(fm("proposed"), usage({ applied_count: 5 }))).toBe(true);
  });

  it("any rejection blocks auto-promotion under default rule", () => {
    expect(
      isAutoPromoteEligible(
        fm("proposed"),
        usage({ read_count: 100, rejected_count: 1 }),
      ),
    ).toBe(false);
  });

  it("custom rule with maxRejections=2 tolerates 2 rejections", () => {
    expect(
      isAutoPromoteEligible(
        fm("proposed"),
        usage({ applied_count: 5, rejected_count: 2 }),
        { minReads: 5, maxRejections: 2 },
      ),
    ).toBe(true);
  });
});
