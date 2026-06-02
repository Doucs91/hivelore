/**
 * Prevention event log — the time-series behind hAIve's OUTCOME metric.
 *
 * `usage.json` keeps a cumulative `prevented_count` per memory (cheap, drives impact). This log
 * keeps one append-only record PER catch, with a timestamp, so we can answer questions a counter
 * can't: how is prevention trending over time, and which lessons keep getting re-introduced after
 * capture (recurrence). Lives in `.ai/.cache/` (gitignored telemetry) — never committed, never
 * churns a release.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export type PreventionSource = "sensor" | "anti-pattern";

export interface PreventionEvent {
  /** ISO timestamp of the catch. */
  at: string;
  /** Memory id whose lesson fired. */
  id: string;
  /** Which gate path recorded it. */
  source: PreventionSource;
}

export function preventionLogPath(paths: HaivePaths): string {
  return path.join(paths.haiveDir, ".cache", "prevention-log.jsonl");
}

/** Append one catch to the log. Best-effort, creates the dir on demand. */
export async function appendPreventionEvent(paths: HaivePaths, event: PreventionEvent): Promise<void> {
  const file = preventionLogPath(paths);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(event) + "\n", "utf8");
}

/** Read all catch events (skips malformed lines). */
export async function loadPreventionEvents(paths: HaivePaths): Promise<PreventionEvent[]> {
  const file = preventionLogPath(paths);
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8").catch(() => "");
  const events: PreventionEvent[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as PreventionEvent;
      if (e && typeof e.at === "string" && typeof e.id === "string") events.push(e);
    } catch {
      // skip a corrupt line rather than fail the whole read
    }
  }
  return events;
}

// ── Pure analytics over the event log ───────────────────────────────────────

export interface PreventionTrend {
  /** Catches in the last 7 days. */
  last_7d: number;
  /** Catches in the last 30 days. */
  last_30d: number;
  /** Catch counts per ISO week, oldest → newest, for the last N weeks (default 6). */
  weekly: number[];
}

const MS_PER_DAY = 86_400_000;

export function computePreventionTrend(
  events: PreventionEvent[],
  now: Date = new Date(),
  weeks = 6,
): PreventionTrend {
  const nowMs = now.getTime();
  let last7 = 0;
  let last30 = 0;
  const weekly = new Array<number>(weeks).fill(0);
  for (const e of events) {
    const t = Date.parse(e.at);
    if (!Number.isFinite(t)) continue;
    const ageDays = (nowMs - t) / MS_PER_DAY;
    if (ageDays < 0) continue;
    if (ageDays <= 7) last7 += 1;
    if (ageDays <= 30) last30 += 1;
    const weekIdx = weeks - 1 - Math.floor(ageDays / 7);
    if (weekIdx >= 0 && weekIdx < weeks) weekly[weekIdx] = (weekly[weekIdx] ?? 0) + 1;
  }
  return { last_7d: last7, last_30d: last30, weekly };
}

export interface RecurrenceRow {
  id: string;
  /** Total catches for this memory. */
  catches: number;
  /** Number of distinct UTC days the lesson fired — the recurrence signal. */
  distinct_days: number;
  last_at: string;
}

export interface RecurrenceReport {
  /**
   * Memories whose lesson was caught on >= 2 distinct days — i.e. the mistake was RE-INTRODUCED
   * after it had already been captured and caught once. A high count means a recurring problem the
   * team keeps reintroducing (the guardrail is earning its keep, and the root cause may need a
   * stronger fix than a memory).
   */
  recurring_count: number;
  top: RecurrenceRow[];
}

export function computeRecurrence(events: PreventionEvent[]): RecurrenceReport {
  const byId = new Map<string, { catches: number; days: Set<string>; last: string }>();
  for (const e of events) {
    const cur = byId.get(e.id) ?? { catches: 0, days: new Set<string>(), last: e.at };
    cur.catches += 1;
    cur.days.add(e.at.slice(0, 10));
    if (e.at > cur.last) cur.last = e.at;
    byId.set(e.id, cur);
  }
  const rows: RecurrenceRow[] = [];
  for (const [id, v] of byId) {
    if (v.days.size >= 2) {
      rows.push({ id, catches: v.catches, distinct_days: v.days.size, last_at: v.last });
    }
  }
  rows.sort((a, b) => b.distinct_days - a.distinct_days || b.catches - a.catches);
  return { recurring_count: rows.length, top: rows };
}
