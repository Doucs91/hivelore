import { describe, expect, it } from "vitest";
import { parsePromptFilesTouched, postTaskPrompt } from "../src/prompts/post-task.js";

describe("post_task MCP prompt arguments", () => {
  it("parses the protocol-compatible JSON string form", () => {
    expect(parsePromptFilesTouched('["src/a.ts","src/b.ts"]')).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("also accepts CSV and renders both files", () => {
    const out = postTaskPrompt(
      { task_summary: "audit", files_touched: "src/a.ts, src/b.ts" },
      { paths: { root: "/repo" } } as never,
    );
    expect(out.messages[0]!.content.text).toContain("`src/a.ts`, `src/b.ts`");
  });
});
