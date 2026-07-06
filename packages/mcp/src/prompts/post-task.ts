import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const PostTaskArgsSchema = {
  task_summary: z
    .string()
    .optional()
    .describe("One sentence describing what you just did"),
  files_touched: z
    .string()
    .optional()
    .describe("Files you created or modified during the task, as CSV or a JSON array string"),
};

export type PostTaskArgs = {
  [K in keyof typeof PostTaskArgsSchema]: z.infer<(typeof PostTaskArgsSchema)[K]>;
};

export function postTaskPrompt(
  args: PostTaskArgs,
  ctx: HaiveContext,
): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  const taskLine = args.task_summary ? `\nTask just completed: **${args.task_summary}**` : "";
  const filesTouched = parsePromptFilesTouched(args.files_touched);
  const filesLine =
    filesTouched.length > 0
      ? `\nFiles touched: ${filesTouched.map((f) => `\`${f}\``).join(", ")}`
      : "";

  const text = `You have just finished a task. Before closing this session, take 60 seconds to capture what you learned.
${taskLine}${filesLine}

Project root: \`${ctx.paths.root}\`

## Checklist — answer each question honestly

Go through each item. If the answer is yes, call the corresponding tool immediately.

### 0. Did you read existing code and discover bugs, inconsistencies, or security gaps that weren't in the briefing?
This is the most important question. Deep code reading surfaces issues that no memory captures yet.
Examples of things to look for:
- A method with an invalid signature (e.g. two \`@RequestBody\` on the same handler)
- A configuration that looks wrong or missing (e.g. webhook path not whitelisted in SecurityConfig)
- A component scan / DI issue (e.g. a Spring bean not picked up because the package isn't scanned)
- A DB constraint that will break when you add a new enum value
- A hardcoded value that should be dynamic (e.g. hardcoded tenant id "default-tenant")
- Anything that will silently break in production

→ If yes, call **\`mem_save\`** with \`type="gotcha"\`, \`scope="team"\`, and **anchor it to the file** with \`paths\`.
  This transforms your discovery into institutional knowledge that protects every future agent.

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

### 4. Did you hit a non-obvious bug or surprising behavior in a library or framework?
→ If yes, call **\`mem_save\`** with \`type="gotcha"\` and anchor it to the relevant file paths

### 5. Did you find that an existing memory is outdated or wrong?
→ If yes, call **\`mem_update\`** with the correct information, or **\`mem_reject\`** if it's completely wrong

## The bar — capture only what is UNGUESSABLE

A memory earns its place only if it carries *hard-won, repo-specific knowledge a capable teammate could
NOT infer* from the code, the docs, or common practice. A "decision" that merely restates what the
implementation already shows, a "convention" that is just standard style, a "gotcha" that is generic
best practice — these are noise, and noise makes every future briefing worse. **For a routine change,
capturing nothing is the correct, expected outcome.** Only reach for \`mem_save\` when you can name the
arbitrary constraint (an invariant, a tradeoff with a real WHY, a footgun that cost you time) that the
next agent would otherwise get wrong.

## Rules

- One memory per insight. Don't cram multiple lessons into one body.
- Anchor memories to file paths when possible (the \`paths\` field) — this enables staleness detection.
- Prefer \`scope="team"\` for anything a teammate or future agent would benefit from.
- Skip sections where you genuinely have nothing to add. Don't fabricate memories — an empty post-task
  is better than a corpus of restated obvious facts.
- Scan your exploration history for genuine code-level discoveries (failed approaches, real footguns),
  but hold each to the bar above before saving it.

### 6. Close the session — always
Call **\`mem_session_end\`** with:
- \`goal\`: what you set out to do
- \`accomplished\`: what was actually done (bullet list)
- \`discoveries\`: anything surprising or broken found during this session (leave empty if none)
- \`files_touched\`: the key files you read or modified
- \`next_steps\`: what remains for the next session or a teammate
- \`scope\`: "team" if this task affects the whole team, "personal" otherwise

This creates/updates a single rolling recap that **get_briefing automatically surfaces** at the start of every subsequent session — no token waste re-explaining what happened.

Calling \`mem_session_end\` also **clears the pending-distill marker** (if any), confirming that this session's learnings have been properly captured rather than left as an auto-recap skeleton.

### 7. Verify the git/release/pipeline exit protocol — always
Run **\`hivelore enforce finish\`** before your final response.

This executable gate checks the multi-agent git-sync decision:
- no completed work is left as an uncommitted local diff
- shippable package changes have a lockstep version bump
- the release tag \`vX.Y.Z\` exists when a version was bumped
- commits and tags have been pushed
- the pushed HEAD's GitHub Actions workflow runs have completed successfully when the repo has a GitHub remote
- agents never run \`npm publish\` (publication remains human-owned)

If it blocks, fix the reported Git/version/tag/push/pipeline issue before telling the developer the task is done.

When done, respond with a brief summary: "Saved N memories: [list of IDs]. Session recap saved. Hivelore finish gate passed; GitHub Actions passed when applicable."
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

/** MCP prompt argument values are strings; accept JSON-array text or a compact CSV. */
export function parsePromptFilesTouched(input: string | undefined): string[] {
  const raw = input?.trim();
  if (!raw) return [];
  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim())
          .filter(Boolean);
      }
    } catch { /* fall through to CSV */ }
  }
  return raw.split(",").map((value) => value.trim()).filter(Boolean);
}
