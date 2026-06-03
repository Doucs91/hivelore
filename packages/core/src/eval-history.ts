/**
 * Eval-score history — makes harness QUALITY a trended number, not a one-off.
 *
 * `eval.ts` produces a 0..100 score (retrieval recall/MRR + sensor catch-rate). A single score
 * answers "is the harness good right now?"; this append-only log answers "is it getting better or
 * regressing over releases?" — the question Fowler flags as an open challenge ("evaluating harness
 * coverage as it grows"). Mirrors `prevention.ts`: one JSONL line per run in `.ai/.cache/` so it
 * never churns a release, plus pure trend math the CLI/dashboard can render.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export interface EvalHistoryEntry {
  /** ISO timestamp of the eval run. */
  at: string;
  /** Overall 0..100 score. */
  score: number;
  /** Optional component metrics for richer trend views. */
  mean_recall?: number;
  mrr?: number;
  catch_rate?: number;
  /** Optional version/commit the run was taken at. */
  ref?: string;
}

export function evalHistoryPath(paths: HaivePaths): string {
  return path.join(paths.haiveDir, ".cache", "eval-history.jsonl");
}

/** Append one eval run to the history. Best-effort, creates the dir on demand. */
export async function appendEvalHistory(paths: HaivePaths, entry: EvalHistoryEntry): Promise<void> {
  const file = evalHistoryPath(paths);
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(entry) + "\n", "utf8");
}

/** Read all eval runs (skips malformed lines). */
export async function loadEvalHistory(paths: HaivePaths): Promise<EvalHistoryEntry[]> {
  const file = evalHistoryPath(paths);
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8").catch(() => "");
  const out: EvalHistoryEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const e = JSON.parse(trimmed) as EvalHistoryEntry;
      if (e && typeof e.at === "string" && typeof e.score === "number") out.push(e);
    } catch {
      // skip a corrupt line
    }
  }
  return out;
}

export interface EvalTrend {
  /** Most recent score, or null when there is no history. */
  latest: number | null;
  /** Score before the latest, or null. */
  previous: number | null;
  /** latest − previous (positive = improving). */
  delta: number | null;
  /** Best score ever recorded. */
  best: number | null;
  /** Number of runs recorded. */
  runs: number;
  /** Last N scores oldest → newest for a sparkline. */
  recent: number[];
  /** True when the latest run dropped vs the previous one. */
  regressed: boolean;
}

/** Pure trend over the history (chronological order is enforced internally). */
export function computeEvalTrend(entries: EvalHistoryEntry[], recentN = 10): EvalTrend {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at));
  const scores = sorted.map((e) => e.score);
  const latest = scores.length > 0 ? scores[scores.length - 1]! : null;
  const previous = scores.length > 1 ? scores[scores.length - 2]! : null;
  const delta = latest !== null && previous !== null ? Math.round((latest - previous) * 1000) / 1000 : null;
  const best = scores.length > 0 ? Math.max(...scores) : null;
  return {
    latest,
    previous,
    delta,
    best,
    runs: scores.length,
    recent: scores.slice(-recentN),
    regressed: delta !== null && delta < 0,
  };
}
