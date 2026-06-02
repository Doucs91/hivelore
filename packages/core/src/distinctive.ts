/**
 * Distinctive-token corroboration for the anti-pattern gate.
 *
 * The pre-commit gate used to hard-block whenever a diff shared ANY ≥4-char token
 * with an anchored gotcha's body. That fires on ubiquitous domain words ("memory",
 * "sensor", "scope", "input", "version") and on version-bump diffs — blocking agents
 * for nothing. The fix: a `literal` overlap only corroborates a BLOCK when at least
 * one shared token is *distinctive* to that gotcha — i.e. rare across the gotcha
 * corpus (low document frequency), like `BigInt`, `open-in-view`, `rec_7`. Common
 * words can still surface the warning for review; they just can't hard-block.
 *
 * Pure module (no I/O), TF-IDF-style. Unit-tested in `test/distinctive.test.ts`.
 */

/**
 * Language keywords + ubiquitous code words that would match almost any memory body
 * and so carry no distinguishing signal. Shared by the diff tokenizer and the
 * distinctiveness check so "literal" stays meaningful.
 */
export const CODE_STOPWORDS = new Set([
  "import", "export", "function", "return", "const", "let", "var", "class", "public",
  "private", "protected", "static", "this", "true", "false", "null", "undefined", "void",
  "async", "await", "from", "type", "interface", "extends", "implements", "number", "string",
  "boolean", "value", "default", "case", "break", "continue", "throw", "catch", "finally",
  "else", "while", "for", "new", "super", "yield", "module", "require", "console",
]);

/** Minimum token length kept for word-level matching (shorter tokens are too noisy). */
export const MIN_WORD_LEN = 4;

/** Split text into lowercase word tokens (>= MIN_WORD_LEN, excluding code stopwords). */
export function tokenizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MIN_WORD_LEN && !CODE_STOPWORDS.has(t));
}

export interface DocFrequency {
  /** token -> number of documents (memory bodies) it appears in */
  df: Map<string, number>;
  /** total number of documents */
  total: number;
}

/** Build per-token document frequency across a corpus of memory bodies. */
export function buildDocFrequency(bodies: string[]): DocFrequency {
  const df = new Map<string, number>();
  for (const body of bodies) {
    const unique = new Set(tokenizeWords(body));
    for (const tok of unique) df.set(tok, (df.get(tok) ?? 0) + 1);
  }
  return { df, total: bodies.length };
}

/**
 * Document-frequency cap at/below which a token counts as distinctive. Deliberately
 * strict — "distinctive" means *rare* (≈ the bottom 10% of the corpus), with a floor
 * of 1 so a token appearing in a single memory is always distinctive. Strictness is
 * intentional: blocking is the aggressive action, so we under-block rather than fire
 * on a word that several gotchas happen to share.
 */
export function distinctiveCap(total: number): number {
  return Math.max(1, Math.floor(0.1 * total));
}

/** True when `token` is distinctive (rare) within the corpus. */
export function isDistinctiveToken(token: string, freq: DocFrequency): boolean {
  const tok = token.toLowerCase();
  if (tok.length < MIN_WORD_LEN || CODE_STOPWORDS.has(tok)) return false;
  const df = freq.df.get(tok);
  if (df === undefined) return true; // not seen elsewhere in the corpus → distinctive
  return df <= distinctiveCap(freq.total);
}

/**
 * True when the added diff text shares at least one *distinctive* word token with the
 * memory body. This is the precise corroboration the block decision should require:
 * "the change actually contains the specific thing this gotcha warns about", not
 * "the change happens to mention a common domain word".
 */
export function diffHasDistinctiveOverlap(
  addedDiffText: string,
  memoryBody: string,
  freq: DocFrequency,
): boolean {
  const memoryTokens = new Set(tokenizeWords(memoryBody));
  if (memoryTokens.size === 0) return false;
  for (const tok of new Set(tokenizeWords(addedDiffText))) {
    if (memoryTokens.has(tok) && isDistinctiveToken(tok, freq)) return true;
  }
  return false;
}
