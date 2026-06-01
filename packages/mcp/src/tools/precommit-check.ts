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
  anchored_blocks: z
    .boolean()
    .default(false)
    .describe(
      "When true, ALSO block a high-confidence anti-pattern (attempt/gotcha) that is anchored to a " +
      "touched file AND corroborated by the diff (literal token overlap, or semantic >= 0.45) — not just " +
      "very strong semantic matches. Powers the 'anchored' enforcement gate. Config/docs-only commits are " +
      "still downgraded. Default false preserves the soft, semantic-only blocking behavior.",
    ),
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
  const classifiedWarnings = apResult.warnings.map((warning) => classifyWarning(warning, input.paths, input.anchored_blocks));
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

function classifyWarning(
  warning: AntiPatternsWarning,
  paths: string[],
  anchoredBlocks = false,
): ClassifiedAntiPatternsWarning {
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

  if (warning.reasons.includes("sensor")) {
    if (warning.sensor_severity === "block") {
      return {
        ...warning,
        level: "blocking",
        rationale: "deterministic hAIve sensor with block severity matched the added diff",
        affected_files: affectedFiles,
        repair_command: repairCommand,
      };
    }
    return {
      ...warning,
      level: "review",
      rationale: "deterministic hAIve sensor with warn severity matched the added diff",
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

  // Anchored gate: when the caller opts in, a high-confidence anti-pattern that is anchored to a
  // touched file AND corroborated by the diff (literal token overlap, or a moderate semantic match)
  // is precise enough to block. This is what makes "known bad approaches are blocked before commit"
  // true for the case it matters most — you are editing the exact file a documented attempt/gotcha
  // warns about, and the diff contains the same idea. Config/docs-only commits already returned
  // above via fileTypeDowngradeReason, so this cannot re-introduce that false-positive class.
  if (
    anchoredBlocks &&
    highConfidence &&
    warning.reasons.includes("anchor") &&
    (warning.reasons.includes("literal") || (hasSemantic && semanticScore >= 0.45))
  ) {
    // Sensor veto: if the memory has a sensor and it did NOT fire, the sensor is the
    // authoritative check for this memory. Broad literal token matching is too noisy
    // to block on its own — the sensor encodes the exact bad pattern. Downgrade to review
    // so the human sees the warning without being hard-blocked on a false positive.
    if (warning.has_sensor && !warning.reasons.includes("sensor")) {
      return {
        ...warning,
        level: "review",
        rationale:
          "memory has a sensor that did not fire — literal match alone is insufficient to block; sensor is the authoritative check",
        affected_files: affectedFiles,
        repair_command: repairCommand,
      };
    }

    return {
      ...warning,
      level: "blocking",
      rationale:
        "high-confidence anti-pattern anchored to a touched file and corroborated by the diff (anchored gate)",
      affected_files: affectedFiles,
      repair_command: repairCommand,
    };
  }

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
  anchoredBlocks = false,
): ClassifiedAntiPatternsWarning {
  return classifyWarning(warning, paths, anchoredBlocks);
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

  // Inverse case: a package/build/tooling gotcha firing on a change that touches NO
  // package/build file. These match by shared tokens ("install", "package", "build")
  // and are almost always false positives on pure source edits.
  const touchesBuildFile = paths.some(isPackageOrConfigPath);
  if (!touchesBuildFile && isBuildScopedWarning(warning) && !warning.reasons.includes("anchor") && !hasStrongSemantic(warning)) {
    return "build/packaging gotcha, but no package/build file changed — downgraded to info.";
  }

  return null;
}

/**
 * True when a warning is about build/packaging/tooling concerns — by its tags, or
 * because every path it is anchored to is itself a package/config file.
 */
function isBuildScopedWarning(warning: AntiPatternsWarning): boolean {
  const tags = warning.tags ?? [];
  if (tags.some((t) => BUILD_SCOPED_TAGS.has(t.toLowerCase()))) return true;
  const anchors = warning.anchor_paths ?? [];
  return anchors.length > 0 && anchors.every(isPackageOrConfigPath);
}

const BUILD_SCOPED_TAGS = new Set([
  "npm", "pnpm", "yarn", "publish", "install", "packaging", "package",
  "build", "tsup", "bundler", "monorepo", "workspace", "versioning", "version",
  "dev-workflow", "hotswap", "ci", "workflow", "release", "changelog",
  "dependencies", "deps", "dependency", "tooling", "config",
]);

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
  const base = lower.split("/").pop() ?? lower;
  return lower.endsWith("package.json") ||
    lower.endsWith("package-lock.json") ||
    lower.endsWith("pnpm-lock.yaml") ||
    lower.endsWith("yarn.lock") ||
    lower.endsWith("bun.lockb") ||
    lower.endsWith(".config.ts") ||
    lower.endsWith(".config.js") ||
    isJsonConfigFile(base) ||
    lower.endsWith(".yml") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".toml") ||
    lower.startsWith(".github/workflows/") ||
    lower.startsWith(".github/") && lower.endsWith(".yml") ||
    // Dotfiles that are pure configuration/tooling — never trigger runtime gotchas
    base === ".gitignore" ||
    base === ".gitattributes" ||
    base === ".gitmodules" ||
    base === ".editorconfig" ||
    base === ".nvmrc" ||
    base === ".node-version" ||
    base === ".npmrc" ||
    base === ".yarnrc" ||
    base === ".yarnrc.yml" ||
    base === ".dockerignore" ||
    base === "dockerfile" ||
    base.startsWith("dockerfile.") ||
    base === ".env.example" ||
    base === ".env.template" ||
    lower.endsWith(".prettierrc") ||
    lower.endsWith(".eslintrc") ||
    lower.endsWith(".eslintignore") ||
    lower.endsWith(".prettierignore") ||
    lower.endsWith(".stylelintrc") ||
    lower.endsWith(".browserslistrc");
}

/**
 * Returns true only for JSON files that are known build/tool configs.
 * Avoids treating application data files (fixtures, translations, schemas) as config.
 */
function isJsonConfigFile(base: string): boolean {
  const knownConfigs = new Set([
    "tsconfig.json", "jsconfig.json",
    "deno.json", "deno.jsonc",
    "nx.json", "turbo.json", "lerna.json", "rush.json",
    "jest.config.json", "vitest.config.json", "babel.config.json",
    ".babelrc.json", ".swcrc", ".mocharc.json",
    "renovate.json", "dependabot.json",
    ".prettierrc.json", ".eslintrc.json", ".stylelintrc.json",
  ]);
  if (knownConfigs.has(base)) return true;
  // tsconfig.*.json (e.g. tsconfig.build.json, tsconfig.test.json)
  if (/^tsconfig\..+\.json$/.test(base)) return true;
  // .*rc.json (e.g. .eslintrc.json already covered, but be safe)
  if (/^\.[a-z]+rc\.json$/.test(base)) return true;
  return false;
}

function repairCommandForWarning(warning: AntiPatternsWarning, paths: string[]): string {
  const firstPath = paths[0];
  return firstPath
    ? `haive briefing --files "${firstPath}" --task "review ${warning.id}"`
    : `haive memory show ${warning.id}`;
}
