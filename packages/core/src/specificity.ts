/**
 * Specificity ("surprise") scoring for memories.
 *
 * hAIve's measured value is preventing agents from reinventing — wrongly — the team's
 * NON-OBVIOUS, arbitrary decisions (e.g. "public ids are internal id + 100000 prefixed AC-",
 * "the status field must be 'OK'/'KO'"). A capable model already knows generic best practice
 * ("use Decimal for money", "validate input"), so surfacing that is pure token overhead.
 *
 * `specificityScore` is a cheap, deterministic heuristic that estimates how *unguessable* a
 * memory is: high when it contains concrete, arbitrary signal (string literals, code
 * identifiers, magic numbers, paths, ALLCAPS constants), low when it is generic prose.
 *
 * It is intentionally a heuristic, not a model call — used to (1) bias briefing ranking toward
 * unguessable knowledge, (2) keep a near-empty briefing cheap when nothing team-specific
 * matches, (3) lint low-value memories, and (4) filter auto-capture candidates.
 */

/** Generic best-practice phrases a capable model already knows — low marginal value to surface. */
const GENERIC_PHRASES: readonly string[] = [
  "validate input", "sanitize", "prepared statement", "parameterized quer",
  "never commit secret", "use environment variable", "handle error", "write test",
  "avoid sql injection", "escape html", "hash password", "use https", "least privilege",
  "do not hardcode", "don't hardcode", "single responsibility", "keep it dry",
  "follow best practice", "use meaningful names", "add error handling", "check for null",
  "use try/catch", "use async/await", "avoid magic number", "write clean code",
];

const STRING_LITERAL = /["'`][^"'`\n]{1,48}["'`]/g;
const BACKTICK_SPAN = /`[^`\n]+`/g;
const CAMEL_CASE = /\b[a-zA-Z_][a-zA-Z0-9_]*[a-z][A-Z][a-zA-Z0-9_]*\b/g;
const SNAKE_CASE = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g;
const DOTTED = /\b\w+\.\w+(?:\.\w+)*\b/g;
const MAGIC_NUMBER = /\b\d{2,}\b|\b\d+\.\d+\b/g;
const FILE_PATH = /\b[\w./-]+\.[a-z]{1,5}\b/g;
const ALLCAPS_CONST = /\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b|\b[A-Z]{3,}\b/g;

function countMatches(text: string, re: RegExp): number {
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * Estimate how unguessable / team-specific a memory body is, in [0, 1].
 * ~0  = generic advice a model already follows by default.
 * ~1  = arbitrary, repo-specific knowledge no model can infer.
 */
export function specificityScore(body: string): number {
  const text = (body ?? "").trim();
  if (text.length === 0) return 0;
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean).length || 1;

  let hits = 0;
  hits += countMatches(text, STRING_LITERAL) * 2;
  hits += countMatches(text, BACKTICK_SPAN) * 2;
  hits += countMatches(text, CAMEL_CASE);
  hits += countMatches(text, SNAKE_CASE);
  hits += countMatches(text, DOTTED);
  hits += countMatches(text, MAGIC_NUMBER);
  hits += countMatches(text, FILE_PATH);
  hits += countMatches(text, ALLCAPS_CONST);

  // Density of concrete signal. The denominator scales with length so a long generic
  // paragraph isn't rescued by a single identifier, while a short, dense rule scores high.
  let score = Math.min(1, hits / Math.max(6, words * 0.35));

  // A memory that reads like generic advice and carries little concrete signal is capped low.
  const generic = GENERIC_PHRASES.some((p) => lower.includes(p));
  if (generic && hits < 4) score = Math.min(score, 0.22);

  return score;
}

/**
 * True when a body uses generic best-practice phrasing a capable model already follows.
 * Used to SCOPE the LOW_VALUE lint: a low-density body is only "guessable noise" when it also
 * reads like generic advice. An arbitrary team *policy* can be prose-y yet unguessable (e.g.
 * "UI text in English, user content in any language") — that must NOT be flagged. Positive
 * evidence (a generic phrase) keeps the lint high-precision and kills that false positive.
 */
export function looksLikeGenericAdvice(body: string): boolean {
  const lower = (body ?? "").toLowerCase();
  return GENERIC_PHRASES.some((p) => lower.includes(p));
}

/** Default threshold below which a memory is considered likely-guessable (low marginal value). */
export const GUESSABLE_THRESHOLD = 0.3;

/** True when a memory body looks like generic knowledge a capable model already has. */
export function isLikelyGuessable(body: string, threshold: number = GUESSABLE_THRESHOLD): boolean {
  return specificityScore(body) < threshold;
}

/**
 * Quality floor for SEEDED memories (stack packs, ingested findings) — the guard against shipping
 * low-value "use const not var" starter content. A seed earns its place only if it is either:
 *   - ENFORCEABLE: it carries a hand-authored sensor (its value is the gate, not its prose), or
 *   - SPECIFIC: it reads as a concrete framework/repo trap (specificity >= floor) and is NOT
 *     generic best-practice prose a capable model already follows.
 * Used both at seed time (skip a memory that fails) and as a CI guard over the shipped pack library.
 *
 * The floor (0.2) is intentionally LOWER than {@link GUESSABLE_THRESHOLD} (0.3, used to lint claimed
 * team knowledge): a seed is explicitly background-priority framework REFERENCE, not a claim of
 * non-guessable team policy, so a concrete framework gotcha with a code example clears it — while
 * genuine garbage ("use const", "write tests") still scores ~0 and/or trips looksLikeGenericAdvice.
 */
export const SEED_QUALITY_FLOOR = 0.2;

export function meetsSeedQualityFloor(
  body: string,
  hasSensor: boolean,
  floor: number = SEED_QUALITY_FLOOR,
): boolean {
  if (hasSensor) return true;
  if (looksLikeGenericAdvice(body)) return false;
  return specificityScore(body) >= floor;
}
