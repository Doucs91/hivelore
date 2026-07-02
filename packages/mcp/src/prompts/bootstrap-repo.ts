import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  assessBootstrapState,
  loadCodeMap,
  loadMemoriesFromDir,
  renderBootstrapChecklist,
  type BootstrapAssessment,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const BootstrapRepoArgsSchema = {
  focus: z
    .string()
    .optional()
    .describe("Optional area to emphasize first (e.g. 'payments', 'auth')."),
};

export type BootstrapRepoArgs = {
  [K in keyof typeof BootstrapRepoArgsSchema]: z.infer<(typeof BootstrapRepoArgsSchema)[K]>;
};

async function currentAssessment(ctx: HaiveContext): Promise<BootstrapAssessment> {
  let projectContextRaw = "";
  try { projectContextRaw = await readFile(ctx.paths.projectContext, "utf8"); } catch { /* absent */ }
  const memories = existsSync(ctx.paths.memoriesDir)
    ? await loadMemoriesFromDir(ctx.paths.memoriesDir)
    : [];
  const codeMap = await loadCodeMap(ctx.paths);
  let existingModules: string[] = [];
  try {
    const entries = await readdir(ctx.paths.modulesContextDir, { withFileTypes: true });
    existingModules = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { /* none */ }
  return assessBootstrapState({
    projectContextRaw,
    memories,
    codeFiles: codeMap ? Object.keys(codeMap.files) : [],
    existingModules,
  });
}

export async function bootstrapRepoPrompt(
  args: BootstrapRepoArgs,
  ctx: HaiveContext,
): Promise<{ description: string; messages: Array<{ role: "user"; content: { type: "text"; text: string } }> }> {
  const assessment = await currentAssessment(ctx);
  const focusLine = args.focus ? `\nEmphasis first: **${args.focus}**.\n` : "";
  const status =
    assessment.state === "ready"
      ? "The knowledge layer is already READY — verify and stop; do not pad it with generic advice."
      : `Current state: **${assessment.state}**. Outstanding gaps:\n\n${renderBootstrapChecklist(assessment)}`;
  const areas = assessment.metrics.components.length > 0
    ? assessment.metrics.components.join(", ")
    : "(no code-map yet — run `hivelore index code` first)";

  const text = `You are the FIRST agent on this repository. Your job before any substantive coding is to fill
Hivelore's knowledge layer so every later agent (and the commit/enforce gates) can rely on it. This is
forced by the bootstrap gate: while the layer is incomplete, commits/finish are blocked.
${focusLine}
Project root: \`${ctx.paths.root}\`
Main code areas detected: ${areas}

## ${status}

## How to close the gaps (do these in order, then re-check)

1. **Project context** — explore high-signal files (manifests, entry points, build configs, main domain
   models). Synthesize a concise overview and save it with the **\`bootstrap_project_save\`** tool. A new
   teammate should be oriented in 5 minutes; link to files instead of pasting big code chunks.

2. **Module contexts** — for each main code area, save a per-module context with
   **\`bootstrap_project_save\`** using \`module=<name>\` (writes \`.ai/modules/<name>/context.md\`).

3. **Anchored memories** — for each main area, capture the team's real, non-obvious knowledge with
   **\`mem_save\`** (\`type\`: decision | gotcha | convention | architecture) anchored with \`paths\`.
   Only record what a capable model could NOT guess from the code — arbitrary repo rules, invariants,
   footguns. Skip generic best practice; the gate's quality floor rejects it.

4. **Sensors (the exhaustive bar)** — for each main area, turn at least one lesson into an enforceable
   guardrail with **\`propose_sensor\`**: \`pattern\` = the faulty usage, \`absent\` = the correct-usage
   marker for "X without Y" lessons. Hivelore VALIDATES your proposal (must be silent on the current
   correct code and fire on the bad example) before trusting it to block — if rejected, the verdict
   tells you how to revise, then propose again.

5. **Re-check** — call \`get_briefing\` again. When the \`__bootstrap_required__\` action_required is gone,
   the layer is READY and the gate will pass.

## Rules
- Write what is true *now*, not aspirational. Note open questions explicitly.
- Prefer a few load-bearing facts over exhaustive enumeration.
- Every memory must be specific to THIS repo; anchor each claim to a file path.
`;

  return {
    description:
      assessment.state === "ready"
        ? "Repo knowledge layer is already ready"
        : `First-agent bootstrap — ${assessment.gaps.length} gap(s) to close`,
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}
