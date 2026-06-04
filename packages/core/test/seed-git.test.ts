import { describe, expect, it } from "vitest";
import { isNoiseSubject, proposeSeedsFromCommits, type GitCommit } from "../src/seed-git.js";

function c(sha: string, subject: string, files: string[] = []): GitCommit {
  return { sha, subject, files };
}

describe("proposeSeedsFromCommits", () => {
  it("proposes an attempt from a Revert commit", () => {
    const out = proposeSeedsFromCommits([c("abc123", 'Revert "use BigInt for ids"', ["src/id.ts"])]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("revert");
    expect(out[0]!.what).toBe("use BigInt for ids");
    expect(out[0]!.paths).toEqual(["src/id.ts"]);
    expect(out[0]!.why_failed).toContain("reverted");
  });

  it("detects hotfix/urgent fix commits", () => {
    const out = proposeSeedsFromCommits([c("def456", "hotfix: broken build in payments")]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("fixup");
  });

  it("ignores ordinary commits", () => {
    const out = proposeSeedsFromCommits([c("1", "feat: add dashboard"), c("2", "chore: bump deps")]);
    expect(out).toHaveLength(0);
  });

  it("detects workaround/hack commits as a workaround signal", () => {
    const out = proposeSeedsFromCommits([
      c("w1", "add temporary workaround for flaky payment webhook", ["src/pay.ts"]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("workaround");
    expect(out[0]!.why_failed).toContain("workaround");
  });

  it("matches hack / band-aid stop-gap wording", () => {
    const out = proposeSeedsFromCommits([
      c("h1", "hacky fix to unblock release"),
      c("h2", "band-aid for race condition"),
    ]);
    expect(out.map((o) => o.kind)).toEqual(["workaround", "workaround"]);
  });

  it("does NOT treat a compound feature name ('env-workaround') as a workaround admission", () => {
    const out = proposeSeedsFromCommits([
      c("x1", "chore: apply env-workaround down-rank to existing corpus"),
      c("x2", "feat: add workaround-registry module"),
    ]);
    expect(out).toHaveLength(0);
  });

  it("dedupes by slug and respects the limit", () => {
    const commits = [
      c("1", 'Revert "same change"'),
      c("2", 'Revert "same change"'),
      c("3", 'Revert "other change"'),
    ];
    const out = proposeSeedsFromCommits(commits);
    expect(out).toHaveLength(2);
    expect(proposeSeedsFromCommits(commits, 1)).toHaveLength(1);
  });
});

describe("seed-git quality floor (noise subjects)", () => {
  it("isNoiseSubject flags merge/bump/deps/wip/format, not real lessons", () => {
    expect(isNoiseSubject("Merge branch 'feature/login'")).toBe(true);
    expect(isNoiseSubject("bump deps")).toBe(true);
    expect(isNoiseSubject("update dependencies")).toBe(true);
    expect(isNoiseSubject("v1.2.3")).toBe(true);
    expect(isNoiseSubject("wip: trying stuff")).toBe(true);
    expect(isNoiseSubject("prettier")).toBe(true);
    expect(isNoiseSubject("add Stripe webhook idempotency key")).toBe(false);
  });

  it("does not propose seeds from reverted/fixed noise commits", () => {
    const out = proposeSeedsFromCommits([
      c("a1", 'Revert "Merge branch \'main\' into dev"', ["x.ts"]),
      c("a2", 'Revert "bump deps"'),
      c("a3", "hotfix: update dependencies"),
      c("a4", 'Revert "add Stripe webhook idempotency key"', ["src/pay.ts"]),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.what).toBe("add Stripe webhook idempotency key");
  });
});
