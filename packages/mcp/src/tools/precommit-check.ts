import { z } from "zod";
import type { HaiveContext } from "../context.js";
import { antiPatternsCheck, type AntiPatternsWarning } from "./anti-patterns-check.js";
import { memForFiles } from "./mem-for-files.js";
import { memVerify } from "./mem-verify.js";

export const PreCommitCheckInputSchema = {
  diff: z
    .string()
    .optional()
    .describe(
      "Raw unified diff text to scan. If omitted, only `paths` is used. " +
      "When called from a pre-commit hook, pipe the output of `git diff --cached`.",
    ),
  paths: z
    .array(z.string())
    .default([])
    .describe("Project-relative paths affected by the change. At least one of `diff` or `paths` should be provided."),
  block_on: z
    .enum(["any", "high-confidence", "never"])
    .default("high-confidence")
    .describe(
      "When to set should_block=true: " +
      "'any' = any warning blocks; " +
      "'high-confidence' = only warnings from authoritative/trusted memories block; " +
      "'never' = report only, never block.",
    ),
  semantic: z
    .boolean()
    .default(true)
    .describe("Enable semantic search in anti_patterns_check (requires embeddings index)."),
};

export type PreCommitCheckInput = {
  [K in keyof typeof PreCommitCheckInputSchema]: z.infer<(typeof PreCommitCheckInputSchema)[K]>;
};

export interface PreCommitCheckOutput {
  /** True when at least one finding meets the configured block_on threshold. */
  should_block: boolean;
  /** Per-section summary; clients should surface the warnings + reasons to the user. */
  summary: {
    anti_patterns: number;
    blocking_warnings?: number;
    relevant_memories: number;
    stale_anchors: number;
  };
  warnings: AntiPatternsWarning[];
  /** Memories anchored to the touched files — convention reminders for the change author. */
  relevant_memories: Array<{
    id: string;
    type: string;
    confidence: string;
    body_preview: string;
  }>;
  /** Memories whose anchored paths overlap with the diff AND are now stale — likely outdated knowledge. */
  stale_anchors: Array<{
    id: string;
    paths: string[];
    body_preview: string;
  }>;
  notice?: string;
}

/**
 * One-shot "should I block this commit?" check.
 *
 * Combines three signals into a single call agents and git hooks can consume:
 *   1. anti_patterns_check — known gotchas/attempts that match the diff
 *   2. mem_for_files — conventions/decisions anchored to touched files
 *   3. mem_verify — memories whose anchors are stale (knowledge may be wrong)
 *
 * Returns should_block per the configured threshold, plus the raw findings so
 * the caller can render them. CLI wrapper: `haive precommit`.
 */
export async function preCommitCheck(
  input: PreCommitCheckInput,
  ctx: HaiveContext,
): Promise<PreCommitCheckOutput> {
  if (!input.diff && input.paths.length === 0) {
    return {
      should_block: false,
      summary: { anti_patterns: 0, relevant_memories: 0, stale_anchors: 0 },
      warnings: [],
      relevant_memories: [],
      stale_anchors: [],
      notice: "Nothing to check — provide either `diff` or `paths`.",
    };
  }

  // 1. Known anti-patterns
  const apResult = await antiPatternsCheck({
    diff: input.diff,
    paths: input.paths,
    limit: 20,
    semantic: input.semantic,
  }, ctx);

  // 2. Relevant conventions/decisions for the touched files
  const relevant = input.paths.length > 0
    ? await memForFiles({ files: input.paths, include_module_contexts: false, track: false }, ctx)
    : { by_anchor: [], by_module: [], by_domain: [], module_contexts: [], inferred_modules: [] };
  // Anchor matches are the most relevant for pre-commit; include module hits as a softer signal.
  const relevantMatches = [...relevant.by_anchor, ...relevant.by_module];

  // 3. Verify anchors — surface stale memories that touch these files
  const verifyResult = input.paths.length > 0
    ? await memVerify({ update: false, id: undefined }, ctx)
    : { results: [], summary: { checked: 0, fresh: 0, stale: 0, anchorless_skipped: 0, updated: 0 } };
  // We surface a stale memory when at least one of the verify hits says stale=true.
  // We don't have direct access to the memory's anchored paths from MemVerifyHit, so we rely on
  // mem_for_files to scope these to "memories that touch our files".
  const filesTouching = new Set(relevantMatches.map((m) => m.id));
  const staleHits = verifyResult.results.filter((r) => r.stale && filesTouching.has(r.id));

  // Determine should_block
  const blockOn = input.block_on;
  const blockingWarnings = apResult.warnings.filter(isBlockingWarning);
  let should_block = false;
  if (blockOn !== "never") {
    if (blockOn === "any" && (apResult.warnings.length > 0 || staleHits.length > 0)) should_block = true;
    if (blockOn === "high-confidence" && (blockingWarnings.length > 0 || staleHits.length > 0)) should_block = true;
  }

  // Map mem_for_files output to a simpler shape
  const relevant_memories = relevantMatches.slice(0, 8).map((m) => ({
    id: m.id,
    type: m.type,
    confidence: String(m.confidence),
    body_preview: (m.body ?? "").split("\n").slice(0, 4).join("\n").slice(0, 250),
  }));

  return {
    should_block,
    summary: {
      anti_patterns: apResult.warnings.length,
      blocking_warnings: blockingWarnings.length,
      relevant_memories: relevant_memories.length,
      stale_anchors: staleHits.length,
    },
    warnings: apResult.warnings,
    relevant_memories,
    stale_anchors: staleHits.map((r) => ({
      id: r.id,
      // The matching `relevantMatches` entry tells us which paths overlap.
      paths: relevantMatches.find((m) => m.id === r.id)
        ? input.paths.filter((p) => relevantMatches.some((m) => m.id === r.id))
        : [],
      body_preview: r.reason ?? "anchored code drifted; verify before relying on this memory",
    })),
  };
}

function isBlockingWarning(warning: AntiPatternsWarning): boolean {
  const highConfidence = warning.confidence === "authoritative" || warning.confidence === "trusted";
  if (!highConfidence) return false;

  // Anchors and lexical matches prove relevance, not violation. A broad diff
  // can touch package files or share common tokens with old gotchas. Require
  // a semantic corroboration strong enough to indicate the same mistake.
  return warning.reasons.includes("semantic") && (warning.semantic_score ?? 0) >= 0.65;
}
