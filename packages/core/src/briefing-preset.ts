/**
 * Named budgets for get_briefing so agents choose quality vs token cost intentionally.
 */

export type BriefingBudgetPreset = "quick" | "balanced" | "deep";

export interface BriefingBudgetNumbers {
  max_tokens: number;
  max_memories: number;
  include_module_contexts: boolean;
}

export const BRIEFING_PRESET_DEFAULTS: Record<BriefingBudgetPreset, BriefingBudgetNumbers> = {
  /** Fast session start — minimal tokens, skip module CONTEXT.md slices */
  quick: { max_tokens: 2500, max_memories: 5, include_module_contexts: false },
  /** Historical defaults for get_briefing */
  balanced: { max_tokens: 8000, max_memories: 8, include_module_contexts: true },
  /** Deep refactor / onboarding — richer memory surface */
  deep: { max_tokens: 16_000, max_memories: 14, include_module_contexts: true },
};

/**
 * Merge preset-derived numbers with caller overrides when no preset was selected.
 */
export function resolveBriefingBudget(
  preset: BriefingBudgetPreset | undefined,
  overrides: BriefingBudgetNumbers,
): BriefingBudgetNumbers {
  if (!preset) return { ...overrides };
  const p = BRIEFING_PRESET_DEFAULTS[preset];
  return {
    max_tokens: p.max_tokens,
    max_memories: p.max_memories,
    include_module_contexts: p.include_module_contexts,
  };
}
