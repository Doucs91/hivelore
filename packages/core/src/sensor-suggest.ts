import type { Sensor } from "./types.js";
import { sensorPatternBrittleness } from "./sensors.js";

const CODE_TOKEN_RE = /`([^`\n]{3,80})`|["']([A-Za-z0-9_.:-]{3,80})["']|\b([A-Za-z][A-Za-z0-9_.:-]{2,79})\b/g;

const SENSOR_STOPWORDS = new Set([
  "about", "after", "again", "agent", "always", "anchor", "approach", "because",
  "before", "break", "broken", "cannot", "change", "code", "commit", "correct",
  "could", "default", "detect", "direct", "directory", "does", "error", "failed",
  "fails", "file", "files", "future", "haive", "instead", "memory", "never", "project",
  "recorded", "repo", "return", "should", "source", "string", "this",
  "tried", "true", "type", "undefined", "value", "when", "where", "which", "with",
  "without",
  // Error/diagnostic words: tokens lifted from an incident's *error output* (not the code to avoid)
  // produced dead sensors like `CACError:Unknown` / `Fallback:ci.yml` that never match a real diff.
  "unknown", "exception", "fallback", "stack", "trace", "output", "message", "warning",
]);

export interface SensorSuggestionOptions {
  /** Extra paths to put on the sensor. Defaults to the memory anchor paths. */
  paths?: string[];
}

/**
 * A non-persisted sensor *seed*: a candidate pattern (and optional discriminating `absent` companion)
 * extracted heuristically from a lesson body, handed to the agent to PRE-FILL a `propose_sensor` call.
 *
 * A seed is NOT a live guardrail. The agent-in-the-loop write paths no longer persist heuristic
 * sensors onto frontmatter; instead they surface this seed so the agent can refine it and let
 * `propose_sensor` validate it (silent on current code, fires on the bad example) before it is trusted
 * to block. This is the "generate-then-validate via the LLM" pipeline — the heuristic only proposes.
 */
export interface SensorSeed {
  /** Regex matching the faulty usage. */
  pattern: string;
  /** Regex for the correct-usage marker (discriminating sensor) — present for "X without Y" lessons. */
  absent?: string;
  /** LLM-facing fix message derived from the lesson. */
  message: string;
  /** Scope paths for the eventual sensor (the lesson's anchor paths). */
  paths: string[];
}

/**
 * Conservatively extract a sensor SEED from a gotcha/attempt body — a candidate pattern for the agent
 * to validate via `propose_sensor`, never a persisted live sensor.
 *
 * This helper intentionally returns null more often than it guesses: a wrong seed wastes an agent's
 * attention, so when no distinctive token / discriminating companion is found it yields nothing and
 * the agent is simply told to author the pattern itself.
 */
export function suggestSensorSeed(
  body: string,
  anchorPaths: string[],
  options: SensorSuggestionOptions = {},
): SensorSeed | null {
  const paths = options.paths ?? anchorPaths;
  if (paths.length === 0) return null;

  const negativeText = body.split(/\*\*Instead,\s*use:\*\*|^##\s+Instead\b/im)[0] ?? body;
  const assignment = pickAssignmentPattern(negativeText);
  const lowercaseValue = assignment ? null : pickLowercaseValuePattern(negativeText);

  // Discriminating "X without Y" sensor. When neither a key=value nor a lowercase pattern applies,
  // look for a REQUIRED COMPANION ("create WITHOUT idempotencyKey", "must pass idempotencyKey") and
  // emit pattern=trigger (the risky call) + absent=companion (the correct-usage marker). The sensor
  // then fires on the faulty call ONLY — not on every call — which is what makes it safe to promote.
  const required = !assignment && !lowercaseValue ? pickRequiredCompanion(body) : null;

  let companion: { trigger: string; required: string; plain: boolean } | null = null;
  if (required) {
    // Pick the trigger EXCLUDING the required companion. Otherwise, when the companion (Y) is a longer/
    // more distinctive token than the call (X) — e.g. "createOrder without idempotencyKey" — the plain
    // distinctive-token pick returns Y, the equality guard bails out, and the fallback below would emit
    // a sensor whose pattern is Y. That sensor fires on CORRECT usage (Y present) and stays silent on
    // the actual fault: an inverted, self-contradictory guardrail. Excluding Y keeps the trigger = X.
    let trigger = pickDistinctiveToken(negativeText, [required]);
    let plain = false;
    // Plain-word call ("calling charge without idempotencyKey"): the trigger isn't code-shaped, so the
    // strict pick returns null. Because `required` is always a DISTINCTIVE token (pickRequiredCompanion
    // enforces it) and the sensor only fires when it is ABSENT, a word-bounded plain trigger gated by
    // that companion is safe enough as a warn sensor. Without this, common "doX without <key>" lessons
    // (verbs like charge/login/create) produce no guardrail at all.
    if (!trigger) {
      const word = pickPlainTrigger(body, required);
      if (word) { trigger = word; plain = true; }
    }
    if (
      trigger &&
      trigger.toLowerCase() !== required.toLowerCase() &&
      !trigger.toLowerCase().includes(required.toLowerCase()) &&
      !sensorPatternBrittleness(escapeRegExp(trigger))
    ) {
      companion = { trigger, required, plain };
    }
  }

  // The fallback token must ALSO exclude the required companion: a "X without Y" memory whose trigger
  // could not be isolated must yield no sensor rather than degrade into a plain `pattern=Y` (the
  // inverted sensor above). Excluding Y here means an un-isolable case returns null — the safe default.
  const fallbackToken = pickDistinctiveToken(negativeText, required ? [required] : []);
  const token = assignment?.label ?? lowercaseValue?.label ?? companion?.trigger ?? fallbackToken;
  if (!token) return null;

  const pattern =
    assignment?.pattern ?? lowercaseValue?.pattern ??
    (companion?.plain
      ? `\\b${escapeRegExp(companion.trigger)}\\b` // word-bound a plain-word call to limit false matches
      : escapeRegExp(companion?.trigger ?? token));
  // Belt-and-suspenders: never emit a pattern that is already known to be brittle (line numbers, etc.).
  if (sensorPatternBrittleness(pattern)) return null;

  const seed: SensorSeed = {
    pattern,
    paths,
    message: companion ? companionMessage(body, companion) : sensorMessageFromBody(body, token),
  };
  if (companion) seed.absent = escapeRegExp(companion.required);
  return seed;
}

/**
 * @deprecated The agent-in-the-loop write paths no longer persist heuristic sensors — they surface a
 * {@link SensorSeed} for `propose_sensor` to validate instead. This wrapper remains only for
 * back-compat (and the scanner-ingestion draft path, where the sensor lands on a human-reviewed
 * `proposed` draft and can never hard-block). It builds the old `autogen: true, severity: "warn"`
 * sensor from a seed. Prefer {@link suggestSensorSeed}.
 */
export function suggestSensorFromMemory(
  body: string,
  anchorPaths: string[],
  options: SensorSuggestionOptions = {},
): Sensor | null {
  const seed = suggestSensorSeed(body, anchorPaths, options);
  if (!seed) return null;
  return {
    kind: "regex",
    pattern: seed.pattern,
    ...(seed.absent ? { absent: seed.absent } : {}),
    paths: seed.paths,
    message: seed.message,
    severity: "warn",
    autogen: true,
    last_fired: null,
  };
}

/**
 * Detect a required-companion token: the thing that, when MISSING, makes the call faulty
 * ("create without an idempotencyKey", "must pass idempotencyKey"). Returns a distinctive code
 * token or null. Used to build a discriminating `absent` regex.
 */
function pickRequiredCompanion(text: string): string | null {
  const tok = "([A-Za-z`'\"$][\\w.$-]{2,79})";
  const patterns = [
    new RegExp(`\\bwithout\\s+(?:an?|the|its|explicit|a\\s+valid|passing|setting|providing)?\\s*${tok}`, "i"),
    new RegExp(`\\bmissing\\s+(?:an?|the|its)?\\s*${tok}`, "i"),
    new RegExp(`\\bforgot(?:\\s+to\\s+\\w+)?\\s+(?:an?|the)?\\s*${tok}`, "i"),
    new RegExp(`\\b(?:must|should|always|need\\s+to|needs\\s+to)\\s+(?:pass|provide|include|set|add|receive|specify|supply)\\s+(?:an?|the)?\\s*${tok}`, "i"),
    // NOTE: `\bno\s+X` is intentionally NOT a required-companion signal. It is ambiguous: in an
    // attempt/gotcha title "No BigInt" means *avoid* BigInt (X is the bad token), not "BigInt is
    // required and missing". Treating it as required produced inverted sensors like "JSON without
    // BigInt". The other forms above (without/missing/forgot/must-pass X) are unambiguous: X is desired.
  ];
  for (const re of patterns) {
    const candidate = cleanCompanionToken(text.match(re)?.[1]);
    if (candidate && isDistinctiveToken(candidate, false)) return candidate;
  }
  return null;
}

/**
 * The plain-word call immediately before a "without/missing" clause ("calling charge without …",
 * "create without …"). Used only as the trigger of a discriminating sensor that is ALREADY gated by a
 * distinctive `absent` companion, so a bare verb is acceptable. Requires >=5 chars and not a stopword.
 */
const PLAIN_TRIGGER_RE = /\b([A-Za-z][A-Za-z0-9_]{4,40})\s+(?:without|missing)\b/i;
function pickPlainTrigger(text: string, required: string): string | null {
  const tok = PLAIN_TRIGGER_RE.exec(text)?.[1];
  if (!tok) return null;
  const lower = tok.toLowerCase();
  if (lower === required.toLowerCase() || SENSOR_STOPWORDS.has(lower)) return null;
  return tok;
}

function cleanCompanionToken(raw: string | undefined | null): string {
  return (raw ?? "").replace(/^[^\w.$-]+|[^\w.$-]+$/g, "");
}

function companionMessage(body: string, c: { trigger: string; required: string }): string {
  const instead = body.match(/\*\*Instead,\s*use:\*\*\s*([^\n]+)/i)?.[1]?.trim();
  const base = `${c.trigger} without ${c.required}`;
  return instead ? `${base} — ${instead}` : `${base} — add the required ${c.required}.`;
}

function pickLowercaseValuePattern(text: string): { label: string; pattern: string; score: number } | null {
  const candidates: Array<{ label: string; pattern: string; score: number }> = [];
  for (const match of text.matchAll(/\blowercase\s+([A-Za-z][A-Za-z0-9_.:-]{2,79})\s+([a-z][a-z0-9_.:-]{1,40})\b/g)) {
    const key = match[1] ?? "";
    const value = match[2] ?? "";
    if (!isDistinctiveToken(key, true) || isBoringValue(value)) continue;
    candidates.push({
      label: `${key}=${value}`,
      pattern: `${escapeRegExp(key)}\\s*[:=]\\s*["']?${escapeRegExp(value)}["']?`,
      score: key.length + value.length + 35,
    });
  }
  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

function pickAssignmentPattern(text: string): { label: string; pattern: string; score: number } | null {
  const candidates: Array<{ label: string; pattern: string; score: number }> = [];
  for (const source of assignmentSources(text)) {
    for (const match of source.matchAll(/\b([A-Za-z][A-Za-z0-9_.:-]{2,79})\b\s*(=|:)\s*["']?([A-Za-z0-9_.:-]{2,80})["']?/g)) {
      const key = match[1] ?? "";
      const operator = match[2] ?? "";
      const value = match[3] ?? "";
      if (!isDistinctiveToken(key, true) || isBoringValue(value)) continue;
      const label = `${key}${operator}${value}`;
      candidates.push({
        label,
        pattern: `${escapeRegExp(key)}\\s*${escapeRegExp(operator)}\\s*["']?${escapeRegExp(value)}["']?`,
        score: label.length + assignmentContextScore(source, match.index ?? 0, match[0].length),
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0] ?? null;
}

function assignmentContextScore(source: string, index: number, length: number): number {
  const before = source.slice(Math.max(0, index - 50), index).toLowerCase();
  const after = source.slice(index + length, Math.min(source.length, index + length + 50)).toLowerCase();
  const window = `${before} ${after}`;
  let score = 0;
  if (/\b(bad|failed|fails|broke|broken|wrong|avoid|forbid|forbidden|leaks?)\b/.test(after)) score += 50;
  if (/do\s+not|don't|never|should\s+not|must\s+not/.test(window)) score += 40;
  if (/\b(keep|instead|correct|right|use|prefer|allowed)\b/.test(before)) score -= 60;
  if (/\b(keep|instead|correct|right|use|prefer|allowed)\b/.test(after)) score -= 25;
  return score;
}

function assignmentSources(text: string): string[] {
  return [text];
}

function pickDistinctiveToken(text: string, exclude: string[] = []): string | null {
  const excludeSet = new Set(exclude.map((t) => t.toLowerCase()));
  const candidates = new Map<string, { raw: string; score: number }>();
  for (const match of text.matchAll(CODE_TOKEN_RE)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const token = raw.replace(/^[^\w.-]+|[^\w.-]+$/g, "");
    const isCodeLike = Boolean(match[1] ?? match[2]);
    if (!isDistinctiveToken(token, isCodeLike)) continue;
    const key = token.toLowerCase();
    if (excludeSet.has(key)) continue;
    const codeSpanBonus = match[1] ? 20 : match[2] ? 8 : 0;
    const shapeBonus =
      /[-_.:]/.test(token) ? 3 :
      /[A-Z]/.test(token.slice(1)) ? 2 :
      /\d/.test(token) ? 1 : 0;
    const score = token.length + codeSpanBonus + shapeBonus;
    const existing = candidates.get(key);
    if (!existing || score > existing.score) candidates.set(key, { raw: token, score });
  }
  const best = [...candidates.values()].sort((a, b) => b.score - a.score)[0];
  return best?.raw ?? null;
}

/**
 * Reject tokens that produce nonsensical sensors: pure numbers, number ranges / line refs
 * (`1131-1186`), version-ish strings, and bare filenames (`enforce.ts`). A sensor built from these
 * fires on noise and trains agents to ignore the gate — the false-positive failure mode the harness
 * must avoid. (Real reproduced miss: a gotcha body referencing `enforce.ts:1131-1186` produced the
 * regex `enforce\.ts\s*:\s*1131-1186`.)
 */
const FILE_EXT_REF = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|rb|php|cs|cpp|c|h|md|json|ya?ml|toml|lock)\b/i;
function isDegenerateToken(token: string): boolean {
  if (/^[\d.\-:_]+$/.test(token)) return true; // pure number / range / line ref like 1131-1186
  if (/\d+\s*-\s*\d+/.test(token)) return true; // a numeric / line range embedded anywhere (e.g. 1131-1186)
  if (FILE_EXT_REF.test(token)) return true; // contains a filename reference (e.g. enforce.ts, enforce.ts:1131)
  // mostly digits (e.g. a version or id with a stray letter): <=1 letter among many digits
  const letters = (token.match(/[A-Za-z]/g) ?? []).length;
  const digits = (token.match(/\d/g) ?? []).length;
  if (digits >= 3 && letters <= 1) return true;
  return false;
}

function isDistinctiveToken(token: string, isCodeLike: boolean): boolean {
  if (token.length < 4 || token.length > 80) return false;
  if (/^https?:\/\//i.test(token)) return false;
  if (/^\d+$/.test(token)) return false;
  // Prose / error-output fragments (e.g. a backtick span `CACError: Unknown option --runInBand`)
  // make literal patterns that never match a real source diff — the dead-sensor class. Reject them.
  if (/\S\s+\S+\s+\S/.test(token)) return false; // 3+ words → a phrase, not a code symbol
  if (/[A-Za-z]:\s/.test(token)) return false; // "Error: …" message shape
  if (isDegenerateToken(token)) return false;
  const lower = token.toLowerCase();
  if (SENSOR_STOPWORDS.has(lower)) return false;
  if (!/[A-Za-z]/.test(token)) return false;
  const shaped = /[-_.:\d]/.test(token) || /[A-Z]/.test(token.slice(1));
  return shaped || isCodeLike;
}

function isBoringValue(value: string): boolean {
  if (!value || value.length > 80) return true;
  const lower = value.toLowerCase();
  if (lower === "true" || lower === "false") return false;
  if (isDegenerateToken(value)) return true; // numbers / ranges / line refs / filenames are not real values
  return SENSOR_STOPWORDS.has(lower);
}

function sensorMessageFromBody(body: string, token: string): string {
  const instead = body.match(/\*\*Instead,\s*use:\*\*\s*([^\n]+)/i)?.[1]?.trim();
  if (instead) return `Avoid ${token}; ${instead}`;
  const firstGuidance = body
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find((line) => line.length > 0 && !line.startsWith("---"));
  return firstGuidance?.slice(0, 180) || `Avoid ${token}; this matched an autogenerated Hivelore sensor.`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
