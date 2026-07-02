import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const ImportDocsArgsSchema = {
  content: z
    .string()
    .describe("The documentation content to analyze and import as memories (Markdown, README, ADR, etc.)"),
  source: z
    .string()
    .optional()
    .describe("Origin of the content (file path, URL, or document title) — used to anchor memories"),
  scope: z
    .enum(["personal", "team"])
    .default("team")
    .describe("Scope to assign to created memories"),
  dry_run: z
    .boolean()
    .default(false)
    .describe("If true, describe what would be saved without actually calling mem_save"),
};

export type ImportDocsArgs = {
  [K in keyof typeof ImportDocsArgsSchema]: z.infer<(typeof ImportDocsArgsSchema)[K]>;
};

export function importDocsPrompt(
  args: ImportDocsArgs,
  ctx: HaiveContext,
): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  const sourceLine = args.source ? `\nSource: **${args.source}**` : "";
  const dryRunNote = args.dry_run
    ? "\n> **DRY RUN** — describe what you would save but do not call any tools."
    : "";

  const text = `You are given documentation to analyze and import into the Hivelore memory system.
${sourceLine}
Scope: **${args.scope}**
Project root: \`${ctx.paths.root}\`
${dryRunNote}

## Your task

Read the documentation below and extract actionable memories. For each distinct piece of knowledge:

1. **Identify the memory type** — which category fits best?
   - \`convention\` — how things are done here (naming, patterns, workflow)
   - \`decision\` — a choice that was made and why (tradeoffs, constraints)
   - \`gotcha\` — non-obvious behavior, traps, things that surprise newcomers
   - \`architecture\` — structural overview of a system or module
   - \`glossary\` — domain terms and their meaning in this project

2. **Determine the anchor** — which files or symbols does this knowledge apply to? List them in \`paths\`.

3. **Write a focused body** — one memory = one insight. Do not combine multiple unrelated facts.
   - Start with the key fact or rule
   - Add context: why it matters, when it applies
   - Add examples if helpful

4. **Call \`mem_save\`** for each memory (unless dry_run).
   - Set \`scope="${args.scope}"\`
   - Set \`slug\` to a short kebab-case identifier
   - Set \`paths\` to the relevant file paths (extracted from the doc if present)

## Rules

- Skip generic documentation that applies to any project (e.g., "install with npm install").
- Prioritize gotchas, non-obvious decisions, and domain-specific conventions.
- If the same knowledge is repeated in different sections, save it once.
- Maximum 10 memories per import — select the most actionable ones.

## Documentation to import

---

${args.content}

---

When done, respond with: "Imported N memories: [list of IDs]" or "Nothing actionable found."
`;

  return {
    description: "Import documentation as Hivelore memories",
    messages: [
      {
        role: "user",
        content: { type: "text", text },
      },
    ],
  };
}
