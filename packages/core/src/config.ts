/**
 * hAIve project configuration — .ai/haive.config.json
 *
 * In autopilot mode, hAIve operates with zero human intervention:
 *   - Memories go directly to `validated` (no approval cycle)
 *   - `haive sync` auto-approves proposed memories after the delay
 *   - The MCP server saves a session recap automatically on exit
 *   - `get_briefing` auto-generates a minimal project context if none exists
 *   - `haive sync` applies safe self-maintenance repairs (context version, headings,
 *     needs_anchor tags, code-map refresh) without human intervention
 *
 * Multi-repo support:
 *   - crossRepoSources: pull shared memories from other repos on haive sync
 *   - contractFiles: watch API contract files for breaking changes
 *   - hubPath: local path to a shared team-knowledge hub repo
 */
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export const CONFIG_FILE = "haive.config.json";

/** A remote or local repo to pull shared memories from. */
export interface CrossRepoSource {
  /** Human-readable name for this source (used in imported memory tags). */
  name: string;
  /** Local filesystem path to the other project's root (relative or absolute). */
  path?: string;
  /** Git URL — clone/fetch performed automatically. */
  git?: string;
  /** Only import memories matching all of these filters. */
  filter?: {
    /** Only import memories with these tags. */
    tags?: string[];
    /** Only import memories of these types. */
    types?: string[];
  };
}

/** An API contract file to snapshot and monitor for breaking changes. */
export interface ContractFile {
  /** Human-readable name for this contract. */
  name: string;
  /** Path to the contract file, relative to the project root. */
  path: string;
  /** Format of the contract file. */
  format: "openapi" | "graphql" | "proto" | "typescript" | "json-schema";
}

export interface HaiveConfig {
  /** Autopilot mode: maximum autonomy, minimum human intervention. Default: false. */
  autopilot?: boolean;

  /**
   * Adaptive briefing: when get_briefing finds no team-specific (unguessable) memory for the
   * task/files, trim the auto-generated project context so the call stays near-zero-cost.
   * A capable model needs nothing extra in that case. Curated context is never trimmed.
   * Default: true.
   */
  adaptiveBriefing?: boolean;

  /**
   * Memory tags that are EXCLUDED from automatic surfacing in `get_briefing` / `mem_relevant_to`.
   * Purpose: break the self-reinforcing bias loop where strategy/positioning memories get auto-injected
   * into every agent's context and shape its *opinions* (not just its facts). Excluded memories are
   * still fully searchable via explicit `mem_search` / `memory search` — they just don't auto-load.
   * Matching is case-insensitive on frontmatter tags. Default targets clearly-meta tags; override
   * (set to `[]` to disable). Note: this filters by TAG, so tag strategy notes accordingly.
   */
  briefingExcludeTags?: string[];

  /** Default scope for new memories. Default: "personal". Autopilot sets "team". */
  defaultScope?: "personal" | "team";

  /**
   * Default status for new memories saved via mem_save.
   * Autopilot sets "validated" — skips the approval cycle entirely.
   * Default: "draft".
   */
  defaultStatus?: "draft" | "validated";

  /** Auto-approve proposed memories after N hours without rejection. Default: null (disabled). */
  autoApproveDelayHours?: number | null;

  /**
   * Auto-promote proposed→validated after N reads (overrides DEFAULT_AUTO_PROMOTE_RULE).
   * Autopilot sets 1 (immediate on first use).
   */
  autoPromoteMinReads?: number;

  /** Auto-save session recap on MCP server exit. Default: true in autopilot, false otherwise. */
  autoSessionEnd?: boolean;

  /**
   * Persist an auto-generated `session_recap` MEMORY into the `.ai/` corpus on automatic
   * session end (MCP exit / SessionEnd hook). Default: true (preserves historical behavior).
   * Set false to stop the low-signal recap dump from accumulating in — and biasing — the corpus;
   * pair with `sessionHandoff` for an ephemeral NEXT.md handoff instead. Has no effect on a
   * manual `haive session end --goal ...` (an explicit recap is always honored).
   */
  autoSessionRecap?: boolean;

  /**
   * On automatic session end, write/overwrite an ephemeral `NEXT.md` handoff at the repo root
   * (open threads + next steps). Default: false. Meant to be gitignored — one overwritten file,
   * not an accumulating corpus memory. Surfaced as `last_session` when no recap memory exists.
   */
  sessionHandoff?: boolean;

  /**
   * Auto-generate a minimal project context from code-map when project-context.md is still
   * the template. Default: true in autopilot, false otherwise.
   */
  autoContext?: boolean;

  /**
   * Safe self-maintenance performed automatically in autopilot mode.
   * These repairs are intentionally conservative: no guessed anchor is applied
   * without strong evidence, but headings/tags/indexes/context metadata can be
   * kept fresh by the tool itself.
   */
  autoRepair?: {
    /** Keep .ai/project-context.md version metadata aligned with package.json. */
    context?: boolean;
    /** Apply safe memory lint fixes: headings and `needs_anchor` tags. */
    corpus?: boolean;
    /** Refresh .ai/code-map.json during sync when needed. */
    codeMap?: boolean;
    /** Best-effort build of code-search embeddings when @hiveai/embeddings is available. */
    codeSearch?: boolean;
  };

  // ── Multi-repo support ──────────────────────────────────────────────────

  /**
   * Other repos to pull `shared`-scoped memories from during `haive sync`.
   * Each source must have either `path` (local) or `git` (remote URL).
   *
   * Example:
   *   { "name": "backend", "path": "../repo-backend", "filter": { "tags": ["api-contract"] } }
   */
  crossRepoSources?: CrossRepoSource[];

  /**
   * API contract files to snapshot and watch for breaking changes.
   * `haive sync` compares the current file against `.ai/contracts/<name>.lock`
   * and creates a `gotcha` memory if a breaking change is detected.
   *
   * Example:
   *   { "name": "payment-api", "path": "docs/openapi.yaml", "format": "openapi" }
   */
  contractFiles?: ContractFile[];

  /**
   * Local path to a shared team-knowledge hub repo.
   * Used by `haive hub pull` and `haive hub push`.
   * Can be relative (resolved from project root) or absolute.
   */
  hubPath?: string;

  /**
   * Lock file paths to watch for dependency version changes.
   * Auto-detected if not specified (package.json, pom.xml, go.mod, etc.).
   * Set to [] to disable dependency tracking entirely.
   */
  dependencyFiles?: string[];

  /**
   * Agent-enforcement settings. Enabled by default so initialized projects
   * treat hAIve as infrastructure, not an optional convention.
   */
  enforcement?: {
    /** Enforcement posture: advisory reports only, warn in hooks, or block workflow gates. */
    mode?: "off" | "advisory" | "strict";
    /** Require get_briefing / mem_relevant_to before state-changing MCP tools. */
    requireBriefingFirst?: boolean;
    /**
     * Pre-edit (PreToolUse) behaviour when a file's anchored policy was not yet surfaced:
     *   - "advise" (default): inject the relevant memory content into the agent's context and record
     *     it in the briefing marker, then ALLOW the edit — no round-trip, no separate briefing command.
     *   - "block": hard-block the edit until a briefing covers the file (the legacy strict behaviour).
     * The commit-time decision-coverage gate and CI enforcement remain the hard backstops either way.
     */
    preEditGate?: "advise" | "block";
    /** Require a session recap before pre-push / CI gates pass. */
    requireSessionRecap?: boolean;
    /** Require memory anchor verification before pre-commit / CI gates pass. */
    requireMemoryVerify?: boolean;
    /** Block changes when anchored decisions/gotchas have become stale. */
    blockStaleDecisionChanges?: boolean;
    /** Require changed files to be covered by relevant surfaced decisions/policies. */
    requireDecisionCoverage?: boolean;
    /**
     * How hard the pre-commit anti-pattern gate blocks a matching attempt/gotcha:
     *   - off:      never block on anti-patterns (report only)
     *   - review:   block only on a very strong semantic match (score ≥ 0.75) — soft, legacy default
     *   - anchored: ALSO block when a high-confidence anti-pattern is anchored to a touched file
     *               and corroborated by the diff (literal token or semantic ≥ 0.45). High precision.
     *   - strict:   block on any high-confidence anti-pattern match (anchor, literal, or semantic)
     * Config/docs-only commits are always downgraded regardless of this setting.
     * Default: "anchored" — makes "known bad approaches are blocked" true for the precise case.
     */
    antiPatternGate?: "off" | "review" | "anchored" | "strict";
    /**
     * Pre-commit/pre-push decision-coverage behaviour. When true (default), the gate SURFACES the
     * relevant anchored decisions/policies itself and records them in the session marker at commit
     * time — no separate `haive briefing` step required. Set false for the strict legacy behaviour
     * where the commit is blocked until a prior briefing covered those decisions.
     */
    autoBrief?: boolean;
    /**
     * Execute `kind: "shell" | "test"` memory sensors during `haive sensors check`.
     * These run arbitrary repo-authored commands, so they are OFF by default; turn on per repo
     * (or pass `--commands`) once the team trusts the sensors. Regex sensors always run. Default false.
     */
    runCommandSensors?: boolean;
    /**
     * How `haive enforce finish` reacts to hard failures observed this session that were never
     * captured as a lesson (`mem_tried`):
     *   - off:   ignore
     *   - warn:  surface them as an info finding (default — failure detection has false positives)
     *   - block: hard-block finish until each is captured
     * Default: "warn".
     */
    failureCaptureGate?: "off" | "warn" | "block";
    /**
     * How `haive eval --ci` reacts to a harness-quality regression vs the recorded baseline:
     *   - off:   never block
     *   - warn:  report the drop (default)
     *   - block: exit non-zero on any score drop
     * Default: "warn".
     */
    evalRegressionGate?: "off" | "warn" | "block";
    /**
     * Default unread-age window (in days) for `haive memory archive` corpus decay.
     * A noisy or stale corpus is actively harmful — it makes the agent follow outdated policy.
     * Default: 180.
     */
    decayAfterDays?: number;
    /** Minimum score required for strict enforcement gates. */
    scoreThreshold?: number;
    /** Remove generated hAIve runtime/cache files during cleanup gates. */
    cleanupGeneratedArtifacts?: boolean;
    /**
     * MCP tool surface:
     * - enforcement: compact default harness for coding agents
     * - maintenance: corpus/admin tools for humans and team stewards
     * - experimental: research/diagnostic tools that are not core product surface
     * - full: legacy alias for experimental
     */
    toolProfile?: "enforcement" | "maintenance" | "experimental" | "full";
    /** Named memory/policy families enabled for this project. */
    policyPacks?: string[];
    /**
     * Branch on which `enforce finish` enforces the release discipline (lockstep version bump +
     * matching pushed tag) as a HARD gate. On any other branch — feature/* or an integration branch
     * like `develop` — those same checks are advisory (warn), since the version/tag are produced when
     * releasing from this branch, not on every integration commit. Default: "main".
     */
    releaseBranch?: string;
  };
}

/**
 * Tags excluded from automatic briefing surfacing by default. These are "meta" tags — strategy,
 * positioning, competitive analysis, roadmaps — whose memories bias an agent's opinions rather than
 * inform a concrete coding task. Still searchable via explicit mem_search.
 */
export const DEFAULT_BRIEFING_EXCLUDE_TAGS: string[] = [
  "positioning",
  "competitive",
  "strategy",
  "harness-engineering",
  "roadmap",
];

export const DEFAULT_CONFIG: HaiveConfig = {
  autopilot: false,
  defaultScope: "personal",
  defaultStatus: "draft",
  autoApproveDelayHours: null,
  autoPromoteMinReads: 5,
  autoSessionEnd: false,
  autoSessionRecap: true,
  sessionHandoff: false,
  briefingExcludeTags: DEFAULT_BRIEFING_EXCLUDE_TAGS,
  autoContext: false,
  autoRepair: {
    context: false,
    corpus: false,
    codeMap: false,
    codeSearch: false,
  },
  enforcement: {
    mode: "strict",
    requireBriefingFirst: true,
    requireSessionRecap: true,
    requireMemoryVerify: true,
    blockStaleDecisionChanges: true,
    requireDecisionCoverage: true,
    antiPatternGate: "anchored",
    scoreThreshold: 80,
    cleanupGeneratedArtifacts: true,
    toolProfile: "enforcement",
    policyPacks: ["architecture", "gotchas", "security", "domain", "release"],
    releaseBranch: "main",
  },
};

export const AUTOPILOT_DEFAULTS: HaiveConfig = {
  autopilot: true,
  defaultScope: "team",
  defaultStatus: "validated",
  autoApproveDelayHours: 72,
  autoPromoteMinReads: 1,
  autoSessionEnd: true,
  autoSessionRecap: true,
  sessionHandoff: false,
  briefingExcludeTags: DEFAULT_BRIEFING_EXCLUDE_TAGS,
  autoContext: true,
  autoRepair: {
    context: true,
    corpus: true,
    codeMap: true,
    codeSearch: true,
  },
  enforcement: {
    mode: "strict",
    requireBriefingFirst: true,
    requireSessionRecap: true,
    requireMemoryVerify: true,
    blockStaleDecisionChanges: true,
    requireDecisionCoverage: true,
    antiPatternGate: "anchored",
    scoreThreshold: 85,
    cleanupGeneratedArtifacts: true,
    toolProfile: "enforcement",
    policyPacks: ["architecture", "gotchas", "security", "domain", "release"],
    releaseBranch: "main",
  },
};

/** The pre-commit anti-pattern gate hardness levels. */
export type AntiPatternGate = "off" | "review" | "anchored" | "strict";

/**
 * Single source of truth mapping a configured `antiPatternGate` to the
 * `pre_commit_check` parameters that implement it. Both the git-hook path
 * (`haive enforce check`) and the standalone `haive precommit` command derive
 * their behavior from this so the two surfaces can never drift apart.
 */
export function antiPatternGateParams(
  gate: AntiPatternGate,
): { block_on: "any" | "high-confidence" | "never"; anchored_blocks: boolean } {
  switch (gate) {
    case "off":
      return { block_on: "never", anchored_blocks: false };
    case "review":
      return { block_on: "high-confidence", anchored_blocks: false };
    case "strict":
      return { block_on: "any", anchored_blocks: true };
    case "anchored":
    default:
      return { block_on: "high-confidence", anchored_blocks: true };
  }
}

export function configPath(paths: HaivePaths): string {
  return path.join(paths.haiveDir, CONFIG_FILE);
}

export async function loadConfig(paths: HaivePaths): Promise<HaiveConfig> {
  const file = configPath(paths);
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<HaiveConfig>;
    const merged = mergeConfig(DEFAULT_CONFIG, parsed);
    // In autopilot mode, apply autopilot defaults for any field not explicitly set
    if (merged.autopilot) {
      return mergeConfig(AUTOPILOT_DEFAULTS, parsed);
    }
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function loadConfigSync(paths: HaivePaths): HaiveConfig {
  const file = configPath(paths);
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<HaiveConfig>;
    const merged = mergeConfig(DEFAULT_CONFIG, parsed);
    return merged.autopilot
      ? mergeConfig(AUTOPILOT_DEFAULTS, parsed)
      : merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(paths: HaivePaths, config: HaiveConfig): Promise<void> {
  await writeFile(configPath(paths), JSON.stringify(config, null, 2) + "\n", "utf8");
}

function mergeConfig(base: HaiveConfig, override: Partial<HaiveConfig>): HaiveConfig {
  return {
    ...base,
    ...override,
    autoRepair: {
      ...base.autoRepair,
      ...override.autoRepair,
    },
    enforcement: {
      ...base.enforcement,
      ...override.enforcement,
    },
  };
}
