/**
 * Token budgeting helpers. We use the standard heuristic of ~4 chars per token,
 * which is conservative for English/code/markdown. Callers that need exact
 * counts should plug in a real tokenizer; this module only ever over-estimates,
 * so the user's hard limits are respected.
 */

export const CHARS_PER_TOKEN = 4;

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface TruncateOptions {
  /** Maximum tokens allowed in the result (inclusive). */
  maxTokens: number;
  /** Marker inserted where content was dropped. */
  marker?: string;
  /** Where to keep characters from when truncating. Default: head. */
  mode?: "head" | "tail" | "middle";
}

export interface TruncateResult {
  text: string;
  truncated: boolean;
  estimatedTokens: number;
  originalTokens: number;
}

const DEFAULT_MARKER = "\n…[truncated]…\n";

export function truncateToTokens(
  input: string,
  options: TruncateOptions,
): TruncateResult {
  const originalTokens = estimateTokens(input);
  const max = Math.max(0, options.maxTokens);
  if (originalTokens <= max) {
    return { text: input, truncated: false, estimatedTokens: originalTokens, originalTokens };
  }

  if (max === 0) {
    return { text: "", truncated: true, estimatedTokens: 0, originalTokens };
  }

  const marker = options.marker ?? DEFAULT_MARKER;
  const mode = options.mode ?? "head";
  const markerTokens = estimateTokens(marker);
  const budgetChars = Math.max(0, (max - markerTokens) * CHARS_PER_TOKEN);

  let result: string;
  if (budgetChars === 0) {
    result = "";
  } else if (mode === "tail") {
    result = marker + input.slice(input.length - budgetChars);
  } else if (mode === "middle") {
    const half = Math.floor(budgetChars / 2);
    result = input.slice(0, half) + marker + input.slice(input.length - half);
  } else {
    result = input.slice(0, budgetChars) + marker;
  }

  return {
    text: result,
    truncated: true,
    estimatedTokens: estimateTokens(result),
    originalTokens,
  };
}

/**
 * Allocate a global token budget across N parts with relative weights, then
 * truncate each part to its share. Returns parts in input order, paired with
 * truncate metadata.
 */
export interface BudgetPart {
  key: string;
  text: string;
  weight: number;
  mode?: TruncateOptions["mode"];
}

export interface BudgetSlice {
  key: string;
  text: string;
  truncated: boolean;
  estimatedTokens: number;
  originalTokens: number;
  allocatedTokens: number;
}

export function allocateBudget(
  parts: BudgetPart[],
  maxTokens: number,
): BudgetSlice[] {
  if (parts.length === 0) return [];
  const totalWeight = parts.reduce((s, p) => s + Math.max(0, p.weight), 0);
  if (totalWeight === 0) {
    return parts.map((p) => ({
      key: p.key,
      text: "",
      truncated: estimateTokens(p.text) > 0,
      estimatedTokens: 0,
      originalTokens: estimateTokens(p.text),
      allocatedTokens: 0,
    }));
  }

  // First pass: allocate by weight, but if a part's content fits in less than
  // its share, redistribute the surplus to others proportionally.
  const allocations = new Map<string, number>();
  let remaining = maxTokens;
  let remainingWeight = totalWeight;

  // Sort parts by share fit ascending so small ones consume their share first.
  const sortedByFit = [...parts]
    .map((p) => ({
      key: p.key,
      tokens: estimateTokens(p.text),
      share: (p.weight / totalWeight) * maxTokens,
      part: p,
    }))
    .sort((a, b) => a.tokens - b.tokens);

  for (const item of sortedByFit) {
    const myShare = remainingWeight > 0
      ? (item.part.weight / remainingWeight) * remaining
      : 0;
    const grant = Math.min(item.tokens, Math.floor(myShare));
    allocations.set(item.key, grant);
    remaining -= grant;
    remainingWeight -= item.part.weight;
  }

  return parts.map((p) => {
    const allocated = allocations.get(p.key) ?? 0;
    const truncated = truncateToTokens(p.text, {
      maxTokens: allocated,
      mode: p.mode ?? "head",
    });
    return {
      key: p.key,
      text: truncated.text,
      truncated: truncated.truncated,
      estimatedTokens: truncated.estimatedTokens,
      originalTokens: truncated.originalTokens,
      allocatedTokens: allocated,
    };
  });
}
