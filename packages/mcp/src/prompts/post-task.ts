import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const PostTaskArgsSchema = {
  task_summary: z
    .string()
    .optional()
    .describe("One sentence describing what you just did"),
  files_touched: z
    .array(z.string())
    .optional()
    .describe("Files you created or modified during the task"),
};

export type PostTaskArgs = {
  [K in keyof typeof PostTaskArgsSchema]: z.infer<(typeof PostTaskArgsSchema)[K]>;
};

export function postTaskPrompt(
  args: PostTaskArgs,
  ctx: HaiveContext,
): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  const taskLine = args.task_summary ? `\nTask just completed: **${args.task_summary}**` : "";
  const filesLine =
    args.files_touched && args.files_touched.length > 0
      ? `\nFiles touched: ${args.files_touched.map((f) => `\`${f}\``).join(", ")}`
      : "";

  const text = `You have just finished a task. Before closing this session, take 60 seconds to capture what you learned.
${taskLine}${filesLine}

Project root: \`${ctx.paths.root}\`

## Checklist — answer each question honestly

Go through each item. If the answer is yes, call the corresponding tool immediately.

### 1. Did you try an approach that failed?
→ If yes, call **\`mem_tried\`** with:
  - \`what\`: the approach you tried (e.g. "importing gray-matter with ESM dynamic import")
  - \`why_failed\`: why it didn't work
  - \`instead\`: what worked instead
  - \`scope\`: "team" if others will hit the same issue, "personal" if specific to your setup
  - \`paths\`: the files where the issue manifested

### 2. Did you discover a convention that isn't documented?
→ If yes, call **\`mem_save\`** with \`type="convention"\` and \`scope="team"\`

### 3. Did you make an architectural decision?
→ If yes, call **\`mem_save\`** with \`type="decision"\` and document the WHY (constraints, tradeoffs), not just the what

### 4. Did you hit a non-obvious bug or surprising behavior?
→ If yes, call **\`mem_save\`** with \`type="gotcha"\` and anchor it to the relevant file paths

### 5. Did you find that an existing memory is outdated or wrong?
→ If yes, call **\`mem_update\`** with the correct information, or **\`mem_reject\`** if it's completely wrong

## Rules

- One memory per insight. Don't cram multiple lessons into one body.
- Anchor memories to file paths when possible (the \`paths\` field) — this enables staleness detection.
- Prefer \`scope="team"\` for anything a teammate or future agent would benefit from.
- Skip sections where you genuinely have nothing to add. Don't fabricate memories.

When done, respond with a brief summary: "Saved N memories: [list of IDs]" or "Nothing new to save."
`;

  return {
    description: "Post-task reflection: capture what you learned before closing the session",
    messages: [
      {
        role: "user",
        content: { type: "text", text },
      },
    ],
  };
}
