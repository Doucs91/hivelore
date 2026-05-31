import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildFrontmatter,
  isLikelyGuessable,
  memoryFilePath,
  serializeMemory,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

/**
 * mem_observe — capture a code-level discovery made during exploration.
 *
 * Unlike mem_tried (failed approaches) or mem_save (conventions/decisions),
 * mem_observe is for bugs, inconsistencies, and security gaps discovered by
 * reading existing code that were NOT in the briefing. Auto-validated (no review).
 */
export const MemObserveInputSchema = {
  what: z
    .string()
    .min(1)
    .describe("Short title: what did you observe? (e.g. 'MobilePaymentController has two @RequestBody on handleWebhook')"),
  where: z
    .string()
    .min(1)
    .describe("File path(s) where the issue lives — be specific"),
  impact: z
    .string()
    .min(1)
    .describe("What breaks or could break because of this (e.g. 'Spring MVC rejects the handler at startup')"),
  fix: z
    .string()
    .optional()
    .describe("Suggested fix or workaround (optional — leave empty if unknown)"),
  scope: z
    .enum(["personal", "team", "module"])
    .default("team")
    .describe("Visibility scope — defaults to team since discoveries benefit everyone"),
  module: z.string().optional().describe("Module name (required when scope=module)"),
  tags: z.array(z.string()).default([]).describe("Tags for filtering"),
  author: z.string().optional().describe("Author handle or email"),
  force: z
    .boolean()
    .default(false)
    .describe(
      "Save even if the observation looks like generic, guessable knowledge. By default, " +
      "low-specificity observations (things a capable model already knows) are SKIPPED to keep " +
      "the corpus high-signal — only unguessable, team-specific discoveries are worth storing.",
    ),
};

export type MemObserveInput = {
  [K in keyof typeof MemObserveInputSchema]: z.infer<(typeof MemObserveInputSchema)[K]>;
};

export interface MemObserveOutput {
  id: string;
  scope: string;
  file_path: string;
  /** True when the observation was NOT saved because it looked generic/guessable. */
  skipped?: boolean;
  reason?: string;
}

export async function memObserve(
  input: MemObserveInput,
  ctx: HaiveContext,
): Promise<MemObserveOutput> {
  if (!existsSync(ctx.paths.haiveDir)) {
    throw new Error(`No .ai/ directory at ${ctx.paths.root}. Run 'haive init' first.`);
  }

  // Capture filter: hAIve only earns its keep on UNGUESSABLE, team-specific knowledge.
  // Skip generic observations a capable model already makes by default — they only add noise
  // and token cost to future briefings. The caller can override with force=true.
  const signalText = [input.what, input.impact, input.fix ?? ""].join(" ");
  if (!input.force && isLikelyGuessable(signalText)) {
    return {
      id: "",
      scope: input.scope,
      file_path: "",
      skipped: true,
      reason:
        "Observation looks like generic, guessable knowledge (low specificity) — not saved. " +
        "Capture only arbitrary, team-specific facts (exact names, values, formats). Pass force=true to override.",
    };
  }

  const slug = input.what
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 6)
    .join("-");

  // Parse where into anchor paths (comma-separated or single path)
  const anchorPaths = input.where
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  const baseFm = buildFrontmatter({
    type: "gotcha",
    slug,
    scope: input.scope,
    module: input.module,
    tags: input.tags,
    paths: anchorPaths,
    author: input.author,
  });
  // Observations are immediately validated — no review cycle needed
  const frontmatter = { ...baseFm, status: "validated" as const };

  const lines: string[] = [`# ${input.what}`, ""];
  lines.push(`**Where:** \`${input.where}\``);
  lines.push("", `**Impact:** ${input.impact}`);
  if (input.fix) {
    lines.push("", `**Fix/workaround:** ${input.fix}`);
  }
  const body = lines.join("\n") + "\n";

  const file = memoryFilePath(ctx.paths, frontmatter.scope, frontmatter.id, frontmatter.module);
  await mkdir(path.dirname(file), { recursive: true });

  if (existsSync(file)) {
    throw new Error(`Memory already exists at ${file}`);
  }

  await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");

  return { id: frontmatter.id, scope: frontmatter.scope, file_path: file };
}
