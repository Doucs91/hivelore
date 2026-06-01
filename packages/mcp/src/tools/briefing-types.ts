import type { ConfidenceLevel, ImpactTier } from "@hiveai/core";

export type BriefingMemoryPriority = "must_read" | "useful" | "background";

export interface BriefingQuality {
  level: "strong" | "thin" | "noisy";
  reasons: string[];
}

export interface BriefingMemory {
  id: string;
  scope: string;
  type: string;
  module?: string;
  tags: string[];
  status: string;
  confidence: ConfidenceLevel;
  /** Present when confidence is 'low' or 'unverified' — AI should weight this memory cautiously. */
  unverified?: true;
  read_count: number;
  /** Demonstrated-utility score in [0,1] from the closed-loop impact layer (reads + applied + sensor fires vs rejections/stale/dormancy). */
  impact_score?: number;
  /** Impact tier derived from {@link impact_score}. A nudge in ranking; surfaced for transparency. */
  impact_tier?: ImpactTier;
  reasons: Array<"anchor" | "module" | "domain" | "semantic" | "symbol">;
  match_quality: "exact" | "partial" | "semantic";
  semantic_score?: number;
  /** Relevance tier for the current task. `must_read` should be consumed before edits. */
  priority: BriefingMemoryPriority;
  /** Human/agent-readable explanation for why this record was surfaced. */
  why?: string[];
  body: string;
  file_path: string;
}

export interface CodeMapSymbolHit {
  symbol: string;
  /** files that export this symbol */
  locations: Array<{
    file: string;
    kind: string;
    line: number;
    description?: string;
  }>;
}

export interface ActionRequiredItem {
  /** Memory id containing the alert */
  id: string;
  /** Short human-readable summary of the issue */
  summary: string;
  /**
   * The exact message to show the developer before doing anything.
   * Copy-paste this verbatim — do NOT paraphrase or act before confirmation.
   */
  developer_message: string;
}

export interface BriefingOutput {
  task?: string;
  search_mode: "semantic" | "literal_fallback" | "literal";
  match_quality_note?: string;
  inferred_modules: string[];
  last_session?: { id: string; scope: string; revision_count: number; body: string };
  project_context: { content: string; truncated: boolean; is_template?: boolean; auto_generated?: boolean } | null;
  module_contexts: Array<{ name: string; content: string; truncated: boolean }>;
  memories: BriefingMemory[];
  briefing_quality: BriefingQuality;
  symbol_locations?: CodeMapSymbolHit[];
  /**
   * Memories that require explicit human confirmation before any code action.
   * IMPORTANT: for each item, show developer_message to the developer and
   * wait for explicit approval before modifying any code.
   */
  action_required: ActionRequiredItem[];
  decay_warnings: string[];
  setup_warnings: string[];
  /**
   * True when this briefing carries little actionable signal:
   * - project-context.md is still the default template
   * - no memories matched the task (or none exist at all)
   * - no previous session recap
   */
  low_value?: true;
  /**
   * Whether this briefing carries knowledge a capable model could NOT have inferred on its own.
   * - "high": at least one surfaced memory is arbitrary/team-specific (unguessable).
   * - "low":  nothing team-specific matched — a generic agent would reach the same answer.
   */
  briefing_value?: "high" | "low";
  /**
   * Short, action-oriented hints surfaced to the agent based on the briefing payload.
   */
  hints?: string[];
  estimated_tokens: number;
  budget: {
    max_tokens: number;
    spent: { project: number; modules: number; memories: number };
    preset_applied?: "quick" | "balanced" | "deep";
  };
}
