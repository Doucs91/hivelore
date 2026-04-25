import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const BootstrapProjectArgsSchema = {
  module: z
    .string()
    .optional()
    .describe(
      "Optional module name to scope the analysis to (writes to .ai/modules/<module>/context.md)",
    ),
  focus: z
    .string()
    .optional()
    .describe("Optional area to emphasize (e.g. 'data layer', 'API surface')"),
};

export type BootstrapProjectArgs = {
  [K in keyof typeof BootstrapProjectArgsSchema]: z.infer<
    (typeof BootstrapProjectArgsSchema)[K]
  >;
};

const ROOT_TEMPLATE = `# Project context

## Architecture
<one or two paragraphs on the high-level architecture>

## Key modules
- <module-name>: <one line on its purpose>
- ...

## Conventions
- <convention>: <why it matters here>
- ...

## Glossary
- <term>: <definition in this codebase>
- ...

## Gotchas
- <surprising behavior, hidden coupling, or known traps>
- ...
`;

const MODULE_TEMPLATE = `# Module context — {module}

## Purpose
<what this module is for>

## Public surface
- <exported symbol>: <one line>
- ...

## Internals
<key files / classes / functions and how they connect>

## Conventions specific to this module
- ...

## Gotchas
- ...
`;

export function bootstrapProjectPrompt(
  args: BootstrapProjectArgs,
  ctx: HaiveContext,
): { description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> } {
  const target = args.module
    ? `\`.ai/modules/${args.module}/context.md\``
    : "`.ai/project-context.md`";
  const template = args.module
    ? MODULE_TEMPLATE.replace("{module}", args.module)
    : ROOT_TEMPLATE;
  const focusLine = args.focus
    ? `\nEmphasis area for this analysis: **${args.focus}**.\n`
    : "";

  const text = `You are bootstrapping a hAIve shared project context for the team.

Project root: \`${ctx.paths.root}\`
Target file: ${target}
${focusLine}
## What to do

1. Explore the codebase: read the package manifests, top-level directories, build configs, and a representative sample of source files. Do not read every file — pick what gives you the highest signal per file (entry points, config, README if present, main domain models).
2. Synthesize a concise, high-signal context document. Prefer load-bearing facts over exhaustive enumeration. A new teammate (human or AI) should be able to read it in 5 minutes and feel oriented.
3. Match the structure of the template below. Keep each section short — link to files instead of repeating large code chunks.
4. When you are done, call the \`bootstrap_project_save\` tool with the full Markdown content. Use \`overwrite=true\` only if the file already exists and you intend to replace it.

## Template to fill

\`\`\`markdown
${template}\`\`\`

## Tips

- Anchor claims to file paths so future readers can verify them.
- Write what is true *now*, not aspirational. Note open questions explicitly.
- Skip sections that have nothing meaningful to say rather than padding them.
`;

  return {
    description: args.module
      ? `Bootstrap context for module "${args.module}"`
      : "Bootstrap the root project context",
    messages: [
      {
        role: "user",
        content: { type: "text", text },
      },
    ],
  };
}
