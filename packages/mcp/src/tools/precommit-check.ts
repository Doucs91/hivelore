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
    review_warnings?: number;
    info_warnings?: number;
    relevant_memories: number;
    stale_anchors: number;
  };
  warnings: ClassifiedAntiPatternsWarning[];
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

export type AntiPatternLevel = "blocking" | "review" | "info";

export interface ClassifiedAntiPatternsWarning extends AntiPatternsWarning {
  /**
   * blocking = commit gate should fail for the configured threshold;
   * review = plausible but not strong enough to block;
   * info = weak signal, hidden by default in human CLI output.
   */
  level: AntiPatternLevel;
  rationale: string;
  affected_files: string[];
  repair_command: string;
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
  const classifiedWarnings = apResult.warnings.map((warning) => classifyWarning(warning, input.paths));
  const blockingWarnings = classifiedWarnings.filter((w) => w.level === "blocking");
  const reviewWarnings = classifiedWarnings.filter((w) => w.level === "review");
  const infoWarnings = classifiedWarnings.filter((w) => w.level === "info");
  let should_block = false;
  if (blockOn !== "never") {
    if (blockOn === "any" && (blockingWarnings.length > 0 || reviewWarnings.length > 0 || staleHits.length > 0)) should_block = true;
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
      review_warnings: reviewWarnings.length,
      info_warnings: infoWarnings.length,
      relevant_memories: relevant_memories.length,
      stale_anchors: staleHits.length,
    },
    warnings: classifiedWarnings,
    relevant_memories,
    stale_anchors: staleHits.map((r) => {
      const match = relevantMatches.find((m) => m.id === r.id);
      // Intersect the stale memory's anchor paths with the paths the caller provided
      // so the output lists only the touched files that are actually anchored to this memory.
      const overlapping = match
        ? input.paths.filter((p) =>
            match.anchor_paths.some((ap) => ap === p || p.startsWith(ap + "/") || ap.startsWith(p + "/")),
          )
        : [];
      return {
        id: r.id,
        paths: overlapping.length > 0 ? overlapping : (match ? input.paths : []),
        body_preview: r.reason ?? "anchored code drifted; verify before relying on this memory",
      };
    }),
  };
}

function classifyWarning(warning: AntiPatternsWarning, paths: string[]): ClassifiedAntiPatternsWarning {
  const affectedFiles = paths.filter((p) => !p.startsWith(".ai/.usage/"));
  const repairCommand = repairCommandForWarning(warning, affectedFiles);
  const fileDowngrade = fileTypeDowngradeReason(warning, affectedFiles);

  if (fileDowngrade) {
    return {
      ...warning,
      level: "info",
      rationale: fileDowngrade,
      affected_files: affectedFiles,
      repair_command: repairCommand,
    };
  }

  if (isBlockingWarning(warning)) {
    return {
      ...warning,
      level: "blocking",
      rationale:
        "authoritative/trusted memory plus very strong semantic match to the diff (score >= 0.75)",
      affected_files: affectedFiles,
      repair_command: repairCommand,
    };
  }

  const hasSemantic = warning.reasons.includes("semantic");
  const semanticScore = warning.semantic_score ?? 0;
  const highConfidence =
    warning.confidence === "authoritative" || warning.confidence === "trusted";

  if (
    (hasSemantic && semanticScore >= 0.45) ||
    (highConfidence && warning.reasons.includes("anchor") && warning.reasons.includes("literal"))
  ) {
    return {
      ...warning,
      level: "review",
      rationale:
        hasSemantic
          ? "semantic match is plausible but below blocking threshold"
          : "anchored high-confidence memory also matched diff tokens, but no strong semantic proof",
      affected_files: affectedFiles,
      repair_command: repairCommand,
    };
  }

  return {
    ...warning,
    level: "info",
    rationale:
      "weak signal only (literal/anchor/low semantic evidence); surfaced for audit, hidden in concise CLI output",
    affected_files: affectedFiles,
    repair_command: repairCommand,
  };
}

function isBlockingWarning(warning: AntiPatternsWarning): boolean {
  const highConfidence = warning.confidence === "authoritative" || warning.confidence === "trusted";
  if (!highConfidence) return false;

  // Anchors and lexical matches prove relevance, not violation. A broad diff
  // can touch package files or share common tokens with old gotchas. Require
  // a semantic corroboration strong enough to indicate the same mistake. Scores
  // in the 0.65-0.75 range are still useful review signals, but are too noisy
  // to block commits reliably even when the memory is anchored to a test file.
  if (!warning.reasons.includes("semantic")) return false;
  return (warning.semantic_score ?? 0) >= 0.75;
}

export function classifyAntiPatternWarningForTest(
  warning: AntiPatternsWarning,
  paths: string[],
): ClassifiedAntiPatternsWarning {
  return classifyWarning(warning, paths);
}

function fileTypeDowngradeReason(
  warning: AntiPatternsWarning,
  paths: string[],
): string | null {
  if (paths.length === 0) return null;
  if (paths.every((p) => p.startsWith(".ai/.usage/") || p === ".ai/.usage/tool-usage.jsonl")) {
    return ".ai usage logs are local telemetry and never block commits.";
  }

  const docsOnly = paths.every(isDocLikePath);
  if (docsOnly && !hasStrongSemantic(warning)) {
    return "docs/changelog-only change; anti-pattern is downgraded unless semantic evidence is strong.";
  }

  const configOnly = paths.every(isPackageOrConfigPath);
  // Any non-anchored, non-strongly-semantic warning is suppressed on config/workflow-only commits.
  // Gotchas that happen to share tokens with config file names (npm, install, package.json,
  // haive init, workspace:*) would otherwise fire on every dependency bump or workflow change.
  if (configOnly && !warning.reasons.includes("anchor") && !hasStrongSemantic(warning)) {
    return "package/config-only change; warning has no anchor on these files and no strong semantic match — downgraded to info.";
  }

  return null;
}

function hasStrongSemantic(warning: AntiPatternsWarning): boolean {
  return warning.reasons.includes("semantic") && (warning.semantic_score ?? 0) >= 0.65;
}

function isDocLikePath(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.endsWith(".md") ||
    lower.includes("changelog") ||
    lower.startsWith("docs/") ||
    lower.startsWith(".github/") && lower.endsWith(".md");
}

function isPackageOrConfigPath(file: string): boolean {
  const lower = file.toLowerCase();
  return lower.endsWith("package.json") ||
    lower.endsWith("package-lock.json") ||
    lower.endsWith("pnpm-lock.yaml") ||
    lower.endsWith("yarn.lock") ||
    lower.endsWith("bun.lockb") ||
    lower.endsWith(".config.ts") ||
    lower.endsWith(".config.js") ||
    lower.endsWith(".json") ||
    lower.endsWith(".yml") ||
    lower.endsWith(".yaml") ||
    lower.startsWith(".github/workflows/");
}

function looksRuntimeSpecific(warning: AntiPatternsWarning): boolean {
  const text = `${warning.body_preview} ${warning.id}`.toLowerCase();
  return /\b(runtime|controller|request|response|database|transaction|auth|cache|production|service|api|endpoint)\b/.test(text);
}

function repairCommandForWarning(warning: AntiPatternsWarning, paths: string[]): string {
  const firstPath = paths[0];
  return firstPath
    ? `haive briefing --files "${firstPath}" --task "review ${warning.id}"`
    : `haive memory show ${warning.id}`;
}
