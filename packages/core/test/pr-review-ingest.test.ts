import { describe, expect, it } from "vitest";
import { extractReviewLearnings, reviewLearningsToDrafts } from "../src/pr-review-ingest.js";

const comment = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 1,
  path: "src/payments/refund.ts",
  line: 12,
  body: "Never refund more than the captured amount — clamp it.",
  user: { login: "sady", type: "User" },
  html_url: "https://github.com/o/r/pull/123#discussion_r1",
  pull_request_url: "https://api.github.com/repos/o/r/pulls/123",
  ...over,
});

describe("extractReviewLearnings — the PR loop's instruction filter", () => {
  it("keeps human instructions, drops bots, questions, and short reactions", () => {
    const learnings = extractReviewLearnings([
      comment({ id: 1 }),
      comment({ id: 2, body: "Why is this here?" }),
      comment({ id: 3, body: "LGTM 🚀" }),
      comment({ id: 4, body: "You must always pass an idempotencyKey here.", user: { login: "coderabbit[bot]", type: "Bot" } }),
      comment({ id: 5, body: "prefer date-fns over moment for new code" }),
    ]);
    expect(learnings.map((l) => l.comment_id)).toEqual([1, 5]);
    expect(learnings[0]!.pr_number).toBe(123);
    expect(learnings[0]!.path).toBe("src/payments/refund.ts");
  });

  it("the explicit marker bypasses the instruction-shape filter and is stripped from the text", () => {
    const learnings = extractReviewLearnings([
      comment({ id: 9, body: "/hivelore remember public ids are id + 100000 prefixed AC-" }),
    ]);
    expect(learnings).toHaveLength(1);
    expect(learnings[0]!.instruction).toBe("public ids are id + 100000 prefixed AC-");
  });

  it("accepts a normalized top-level PR issue comment without a file anchor", () => {
    const learnings = extractReviewLearnings([
      comment({ id: 12, path: undefined, line: undefined, body: "/hivelore remember never log access tokens" }),
    ]);
    expect(learnings).toHaveLength(1);
    expect(learnings[0]!.path).toBeUndefined();
    expect(reviewLearningsToDrafts(learnings)[0]!.frontmatter.anchor.paths).toEqual([]);
  });

  it("ties replies to their root thread and tolerates garbage payloads", () => {
    const learnings = extractReviewLearnings([
      comment({ id: 10 }),
      comment({ id: 11, in_reply_to_id: 10, body: "Correction: always clamp to capture AND log it." }),
    ]);
    expect(learnings.map((l) => l.thread_id)).toEqual([10, 10]);
    expect(extractReviewLearnings("nonsense")).toEqual([]);
    expect(extractReviewLearnings([{ nope: true }])).toEqual([]);
  });
});

describe("reviewLearningsToDrafts", () => {
  it("templates proposed convention drafts with anchors, provenance, and stable ingest topics", () => {
    const drafts = reviewLearningsToDrafts(extractReviewLearnings([comment({ id: 1 })]));
    expect(drafts).toHaveLength(1);
    const d = drafts[0]!;
    expect(d.frontmatter.status).toBe("proposed");
    expect(d.frontmatter.type).toBe("convention");
    expect(d.frontmatter.tags).toContain("review-learning");
    expect(d.frontmatter.anchor.paths).toEqual(["src/payments/refund.ts"]);
    expect(d.topic).toBe("ingest:github-pr:1");
    expect(d.body).toContain("PR #123");
    expect(d.body).toContain("@sady");
  });

  it("one draft per thread — the latest reply in a thread wins", () => {
    const drafts = reviewLearningsToDrafts(
      extractReviewLearnings([
        comment({ id: 10, body: "Never do X in this file." }),
        comment({ id: 11, in_reply_to_id: 10, body: "Correction: always do Y instead of X." }),
      ]),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.body).toContain("always do Y");
  });
});
