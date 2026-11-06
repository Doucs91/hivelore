/**
 * Failure-capture coverage — the gate behind Hivelore's "never silently fix the same mistake" loop.
 *
 * `hivelore observe` (the PostToolUse hook) appends an observation per tool call to
 * `.ai/.cache/observations.jsonl`, tagging hard failures with `failure_hint: true`
 * (non-zero Bash exit, `error TSxxxx`, ENOENT, …). Those failures are exactly the
 * `mem_tried` candidates the harness wants captured — otherwise the next session repeats them.
 *
 * This module is the pure decision layer: given the failure observations and the corpus's
 * `attempt`/`gotcha` memories, which failures look UNCAPTURED (no lesson recorded after them)?
 * The CLI reads the files and turns the result into an `enforce finish` finding. No I/O here.
 */

export interface FailureObservation {
  /** ISO timestamp of the observation. */
  ts: string;
  /** Tool that failed (Bash / Edit / …). */
  tool: string;
  /** Short human-readable summary of what was attempted. */
  summary: string;
}

export interface UncapturedFailure {
  ts: string;
  tool: string;
  summary: string;
}

export interface FailureCoverageOptions {
  /** Only consider failures newer than this many hours (avoid stale observations blocking forever). Default 24. */
  windowHours?: number;
  /** Collapse near-identical failures (same normalized summary) to one row. Default true. */
  dedupe?: boolean;
  now?: Date;
}

const MS_PER_HOUR = 3_600_000;

function normalizeSummary(summary: string): string {
  return summary.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 160);
}

/**
 * A failure is CAPTURED when an `attempt`/`gotcha` lesson was recorded at or after it
 * (within the window) — the agent stopped and wrote the lesson down. Failures that pre-date
 * every recent capture are uncaptured: the gate should nudge (or block) on those.
 *
 * @param failures     failure-tagged observations (any order)
 * @param captureTimes ISO created_at of every attempt/gotcha memory in the corpus
 */
export function findUncapturedFailures(
  failures: FailureObservation[],
  captureTimes: string[],
  options: FailureCoverageOptions = {},
): UncapturedFailure[] {
  const now = (options.now ?? new Date()).getTime();
  const windowMs = (options.windowHours ?? 24) * MS_PER_HOUR;
  const dedupe = options.dedupe ?? true;

  // The freshest capture timestamp within the window — a lesson recorded after a failure covers it.
  let latestCapture = 0;
  for (const iso of captureTimes) {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && now - t <= windowMs && t > latestCapture) latestCapture = t;
  }

  const seen = new Set<string>();
  const out: UncapturedFailure[] = [];
  for (const f of failures) {
    const t = Date.parse(f.ts);
    if (!Number.isFinite(t)) continue;
    if (now - t > windowMs) continue; // too old to act on
    if (t <= latestCapture) continue; // a capture happened after this failure → covered
    if (dedupe) {
      const key = normalizeSummary(f.summary);
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push({ ts: f.ts, tool: f.tool, summary: f.summary });
  }
  out.sort((a, b) => a.ts.localeCompare(b.ts));
  return out;
}

// ── Distillation: failure observations → PROPOSED lesson drafts (passive capture, Phase 2) ────────

export interface DistilledFailureLesson {
  /** Lesson title — becomes the attempt's `# what` heading and its dedup key. */
  what: string;
  /** The observed error, verbatim-ish (truncated). */
  why_failed: string;
  /** Anchor paths observed on the failing calls (project-relative, caller-normalized). */
  paths: string[];
  /** How many times this failure (same normalized summary) was observed — retries included. */
  occurrences: number;
}

/**
 * Noise that never deserves a lesson: exploratory lookups and navigation/setup builtins whose
 * failure is the answer, not a durable team lesson (a `cd` into a missing dir, a `grep` that found
 * nothing). Always dropped, regardless of how often they repeat.
 */
const EXPLORATORY_RE =
  /^(ls|find|grep|rg|cat|head|tail|which|stat|cd|pushd|popd|pwd|mkdir|rmdir|echo|printf|touch|cp|mv|rm|export|set|unset|source|test|true|false|sleep|wc|sort|uniq|cut|env|\[|\.)\b/i;

/**
 * Substantive commands whose FIRST failure is already signal (a broken test/build/typecheck/lint is
 * worth a lesson even once). Anything else needs a repeat (a retry loop) to clear the signal bar —
 * that is what keeps the passive-capture drafts silent until there is a real struggle to record.
 */
const SUBSTANTIVE_RE =
  /\b(vitest|jest|mocha|pytest|unittest|go\s+test|cargo|gradle|mvn|tsc|typecheck|eslint|biome|ruff|mypy|flake8|pnpm|npm|yarn|bun|make|docker|compose|terraform|prisma|migrate|migration|build|lint)\b/i;

/** Strip the tool prefix so the command classifiers see the real command text. */
function commandText(summary: string): string {
  return summary.replace(/^[A-Za-z_]+:\s*/, "").trim();
}

/**
 * Remove machine-local noise from a failure summary before it reaches a memory or a message:
 * absolute home/temp paths, session UUIDs and long hex ids. Auto-captured drafts used to carry raw
 * command lines with `/tmp/claude-1000/home…` paths and a session UUID in their slug and body
 * (field report #10 §5).
 */
export function sanitizeFailureSummary(summary: string): string {
  return summary
    .replace(/(?:\/(?:home|Users|tmp|var\/folders|private\/tmp)\/[^\s'"`]+)/g, "<path>")
    .replace(/[A-Za-z]:\\(?:Users|Temp)\\[^\s'"`]+/g, "<path>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{20,}\b/gi, "<hash>")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The failures worth a human's attention: never exploratory lookups (a `grep` that found nothing, a
 * `head` closing a pipe), and only a REPEAT (a retry loop) or a substantive test/build/lint command.
 * The same bar applies everywhere a failure is surfaced — recap, finish, auto-capture — so no
 * surface asks the agent to write lessons the capture pipeline itself would discard (field reports
 * #10 §5, #12 §3.2).
 */
export function signalFailures<T extends FailureObservation>(failures: T[]): T[] {
  const counts = new Map<string, number>();
  const kept: T[] = [];
  for (const f of failures) {
    const cmd = commandText(f.summary.trim());
    if (!cmd || EXPLORATORY_RE.test(cmd)) continue;
    const key = normalizeSummary(sanitizeFailureSummary(f.summary));
    counts.set(key, (counts.get(key) ?? 0) + 1);
    kept.push(f);
  }
  return kept.filter((f) => {
    const key = normalizeSummary(sanitizeFailureSummary(f.summary));
    return (counts.get(key) ?? 0) >= 2 || SUBSTANTIVE_RE.test(commandText(f.summary.trim()));
  });
}

/** "pnpm test --filter x" → "pnpm test": the intent a lesson title and slug should carry. */
export function failureIntent(summary: string): string {
  const words = sanitizeFailureSummary(commandText(summary))
    .split(/\s+/)
    .filter((w) => w && !w.startsWith("-") && !w.includes("<") && !/[|;&>]/.test(w));
  return words.slice(0, 3).join(" ") || "command";
}

/**
 * Cluster failure observations by normalized summary and template the top ones into PROPOSED
 * lesson drafts — the deterministic last leg of the passive-capture pipeline (claude-mem captures
 * passively; Hivelore additionally turns the failures into REVIEWABLE corpus candidates).
 *
 * Deterministic templating only — no LLM. Exploratory lookups (a grep that found nothing) are
 * dropped; the caller dedups against the corpus and enforces the per-session cap.
 */
export function distillFailureObservations(
  failures: Array<FailureObservation & { files?: string[] }>,
  options: { max?: number } = {},
): DistilledFailureLesson[] {
  const max = options.max ?? 3;
  const clusters = new Map<string, { first: FailureObservation & { files?: string[] }; count: number; files: Set<string>; substantive: boolean }>();
  for (const f of failures) {
    const summary = sanitizeFailureSummary(f.summary);
    const cmd = commandText(summary);
    if (!summary || EXPLORATORY_RE.test(cmd)) continue;
    const key = normalizeSummary(summary);
    const existing = clusters.get(key);
    if (existing) {
      existing.count++;
      for (const file of f.files ?? []) existing.files.add(file);
    } else {
      clusters.set(key, { first: f, count: 1, files: new Set(f.files ?? []), substantive: SUBSTANTIVE_RE.test(cmd) });
    }
  }
  return [...clusters.values()]
    // Signal bar: keep a draft only when there is real signal — a repeat (a retry loop) OR a failure
    // in a substantive test/build/lint command. A single one-off failure of an ordinary command is
    // not a durable lesson; drafting it just makes the reviewer triage noise. Silent until signal.
    .filter((c) => c.count >= 2 || c.substantive)
    .sort((a, b) => b.count - a.count || b.first.ts.localeCompare(a.first.ts))
    .slice(0, max)
    .map(({ first, count, files }) => {
      const summary = sanitizeFailureSummary(first.summary);
      return {
        what: `\`${failureIntent(summary)}\` failed${count > 1 ? ` ${count}×` : ""}`,
        why_failed: summary.slice(0, 400),
        paths: [...files].slice(0, 6),
        occurrences: count,
      };
    });
}
