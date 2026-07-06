import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("review learning persistence payload", () => {
  afterEach(() => {
    delete process.env.HIVELORE_ACTION_TEST;
    delete process.env.GITHUB_EVENT_PATH;
    vi.restoreAllMocks();
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
    expect(out.file).toMatch(/\.ai\/memories\/team\/.*never-log-access-tokens-42\.md$/);
    expect(out.content).toContain("status: proposed");
    expect(out.content).toContain('topic: "ingest:github-comment:42"');
    expect(out.content).toContain('    - "src/auth.ts"');
    expect(out.content).toContain("PR #7");
  });

  it("authorizes only repository owners, members, and collaborators", async () => {
    process.env.HIVELORE_ACTION_TEST = "1";
    const { isTrustedReviewLearningAuthor } = await import("../src/run.js");
    expect(isTrustedReviewLearningAuthor("OWNER")).toBe(true);
    expect(isTrustedReviewLearningAuthor("member")).toBe(true);
    expect(isTrustedReviewLearningAuthor("COLLABORATOR")).toBe(true);
    expect(isTrustedReviewLearningAuthor("CONTRIBUTOR")).toBe(false);
    expect(isTrustedReviewLearningAuthor("NONE")).toBe(false);
    expect(isTrustedReviewLearningAuthor(undefined)).toBe(false);
  });

  it("rejects an external comment event before any GitHub write call", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hivelore-review-event-"));
    try {
      const event = path.join(dir, "event.json");
      await writeFile(event, JSON.stringify({
        issue: { number: 7, pull_request: {} },
        comment: {
          id: 42,
          body: "/hivelore remember Never execute review text",
          author_association: "CONTRIBUTOR",
          user: { login: "external-user" },
        },
      }), "utf8");
      process.env.HIVELORE_ACTION_TEST = "1";
      process.env.GITHUB_EVENT_PATH = event;
      const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const { handleRememberComment } = await import("../src/run.js");
      await expect(handleRememberComment("issue_comment")).resolves.toBe(true);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("untrusted commenter"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("uses the comment id to prevent same-prefix filename collisions", async () => {
    process.env.HIVELORE_ACTION_TEST = "1";
    const { reviewLearningContent } = await import("../src/run.js");
    const base = { instruction: "Never log access tokens in production", author: "owner", prNumber: 7 };
    const first = reviewLearningContent({ ...base, commentId: 41 });
    const second = reviewLearningContent({ ...base, commentId: 42 });
    expect(first.file).not.toBe(second.file);
    expect(first.file).toContain("-41.md");
    expect(second.file).toContain("-42.md");
  });

  it("updates an existing learning branch/file/PR idempotently", async () => {
    process.env.HIVELORE_ACTION_TEST = "1";
    const { persistReviewLearning } = await import("../src/run.js");
    const create = vi.fn();
    const update = vi.fn().mockResolvedValue({ data: {} });
    const octokit = {
      rest: {
        repos: {
          get: vi.fn().mockResolvedValue({ data: { default_branch: "main" } }),
          getContent: vi.fn().mockResolvedValue({ data: { type: "file", sha: "existing-sha" } }),
          createOrUpdateFileContents: update,
        },
        git: {
          getRef: vi.fn().mockResolvedValue({ data: { object: { sha: "base-sha" } } }),
          createRef: vi.fn().mockRejectedValue({ status: 422 }),
        },
        pulls: {
          list: vi.fn().mockResolvedValue({ data: [{ html_url: "https://example.test/pr/9" }] }),
          create,
        },
      },
    };
    const url = await persistReviewLearning(octokit as never, "acme", "repo", {
      commentId: 42, instruction: "Never log tokens", author: "owner", prNumber: 7,
    });
    expect(url).toBe("https://example.test/pr/9");
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ sha: "existing-sha", branch: "hivelore/review-learning-42" }));
    expect(create).not.toHaveBeenCalled();
  });

  it("keeps the workflow-level trust boundary in front of write permissions", async () => {
    const workflow = await readFile(new URL("../../../.github/workflows/hivelore-review-learning.yml", import.meta.url), "utf8");
    expect(workflow).toContain("github.event.comment.author_association");
    expect(workflow).toContain("OWNER");
    expect(workflow.indexOf("author_association")).toBeLessThan(workflow.indexOf("contents: write"));
  });
});
