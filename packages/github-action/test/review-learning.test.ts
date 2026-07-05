import { afterEach, describe, expect, it, vi } from "vitest";

describe("review learning persistence payload", () => {
  afterEach(() => {
    delete process.env.HIVELORE_ACTION_TEST;
    vi.resetModules();
  });

  it("renders a proposed, anchored, deduplicable team memory", async () => {
    process.env.HIVELORE_ACTION_TEST = "1";
    const { reviewLearningContent } = await import("../src/run.js");
    const out = reviewLearningContent({
      commentId: 42,
      instruction: "Never log access tokens",
      author: "reviewer",
      path: "src/auth.ts",
      prNumber: 7,
    });
    expect(out.file).toMatch(/\.ai\/memories\/team\/.*never-log-access-tokens\.md$/);
    expect(out.content).toContain("status: proposed");
    expect(out.content).toContain('topic: "ingest:github-comment:42"');
    expect(out.content).toContain('    - "src/auth.ts"');
    expect(out.content).toContain("PR #7");
  });
});
