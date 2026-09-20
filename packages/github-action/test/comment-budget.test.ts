import { describe, expect, it } from "vitest";
process.env.HIVELORE_ACTION_TEST = "1";
const { formatComment } = await import("../src/run.js");

describe("PR context budget", () => {
  it("deduplicates a policy shared by many files and keeps the whole comment bounded", () => {
    const policy = { id: "shared-policy", title: "Transaction boundary", type: "gotcha", scope: "team",
      status: "validated", tags: [], anchorPaths: ["src"], requiresHumanApproval: false,
      body: "A distinctive actionable rule. " + "details ".repeat(1000), filePath: ".ai/memories/team/policy.md" };
    const files = Array.from({ length: 80 }, (_, i) => `src/component-${i}.ts`);
    const result = formatComment("Context", new Map(files.map(f => [f, [policy]])), [], files, []);
    expect(result.match(/A distinctive actionable rule/g)).toHaveLength(1);
    expect(result.length).toBeLessThan(3000);
    expect(result).toContain("(+76 files)");
  });
  it("does not present missing knowledge as evidence of understanding", () => {
    const result = formatComment("Context", new Map(), [], ["new.ts"], []);
    expect(result).toContain("Coverage has not been established");
    expect(result).not.toContain("well-understood");
  });
});
