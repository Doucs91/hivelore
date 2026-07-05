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

/** Noise that never deserves a lesson: exploratory lookups whose failure is the answer. */
const EXPLORATORY_RE = /^(ls|find|grep|rg|cat|head|tail|which|stat)\b/i;

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
  const clusters = new Map<string, { first: FailureObservation & { files?: string[] }; count: number; files: Set<string> }>();
  for (const f of failures) {
    const summary = f.summary.trim();
    if (!summary || EXPLORATORY_RE.test(summary.replace(/^Bash:\s*/i, ""))) continue;
    const key = normalizeSummary(summary);
    const existing = clusters.get(key);
    if (existing) {
      existing.count++;
      for (const file of f.files ?? []) existing.files.add(file);
    } else {
      clusters.set(key, { first: f, count: 1, files: new Set(f.files ?? []) });
    }
  }
  return [...clusters.values()]
    .sort((a, b) => b.count - a.count || b.first.ts.localeCompare(a.first.ts))
    .slice(0, max)
    .map(({ first, count, files }) => {
      const summary = first.summary.trim();
      const firstLine = summary.split("\n")[0]!.slice(0, 120);
      return {
        what: `${first.tool} failed: ${firstLine}`,
        why_failed: summary.slice(0, 400),
        paths: [...files].slice(0, 6),
        occurrences: count,
      };
    });
}
