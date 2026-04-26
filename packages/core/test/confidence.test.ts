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

  it("proposed with 3+ reads → trusted", () => {
    expect(deriveConfidence(fm("proposed"), usage({ read_count: 3 }))).toBe("trusted");
  });

  it("validated with low reads → trusted", () => {
    expect(deriveConfidence(fm("validated"), usage({ read_count: 1 }))).toBe("trusted");
  });

  it("validated with 10+ reads → authoritative", () => {
    expect(deriveConfidence(fm("validated"), usage({ read_count: 10 }))).toBe("authoritative");
  });
});

describe("isAutoPromoteEligible", () => {
  it("only proposed can be auto-promoted", () => {
    expect(isAutoPromoteEligible(fm("draft"), usage({ read_count: 99 }))).toBe(false);
    expect(isAutoPromoteEligible(fm("validated"), usage({ read_count: 99 }))).toBe(false);
  });

  it("requires read_count >= minReads (default 5)", () => {
    expect(isAutoPromoteEligible(fm("proposed"), usage({ read_count: 4 }))).toBe(false);
    expect(isAutoPromoteEligible(fm("proposed"), usage({ read_count: 5 }))).toBe(true);
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
        usage({ read_count: 5, rejected_count: 2 }),
        { minReads: 5, maxRejections: 2 },
      ),
    ).toBe(true);
  });
});
