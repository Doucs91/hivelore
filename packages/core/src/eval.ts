import type { LoadedMemory } from "./loader.js";

/**
 * A rigorous, model-free, repeatable evaluation of hAIve's core promise: surfacing
 * the right knowledge and guardrails at the right moment. Unlike the agent benchmark
 * (which parses human-written reports), this is deterministic and CI-runnable — it
 * produces a chiffré quality score from labeled cases, so a regression in ranking or
 * sensor coverage fails the build instead of silently degrading every agent session.
 *
 * Two case families:
 *   - RETRIEVAL — given a task (+optional files/symbols), do the expected memories
 *     surface in the briefing top-k? Measured by recall and mean reciprocal rank.
 *   - SENSORS — given a known-bad diff, does the expected memory's sensor fire?
 *     Measured by catch-rate.
 *
 * This module is pure: it defines the case/result types, the scoring math, and case
 * synthesis from a repo's own anchored memories. Orchestration (calling get_briefing
 * / anti_patterns_check) lives in the CLI, since core cannot depend on the MCP layer.
 */

export interface RetrievalCase {
  name: string;
  task: string;
  files?: string[];
  symbols?: string[];
  /** Memory ids that SHOULD surface in the briefing for this case. */
  expect_ids: string[];
}

export interface SensorCase {
  name: string;
  /** Unified diff (or added-line text) the sensors run against. */
  diff: string;
  paths?: string[];
  /** Memory ids whose sensor SHOULD fire on this diff. */
  expect_fire_ids: string[];
}

export interface EvalSpec {
  retrieval?: RetrievalCase[];
  sensors?: SensorCase[];
}

export interface RetrievalCaseResult {
  name: string;
  expect_ids: string[];
  /** Surfaced memory ids, in ranked order, capped at k. */
  surfaced_ids: string[];
  hits: string[];
  misses: string[];
  precision: number;
  recall: number;
  /** 1-based rank of the first expected id among surfaced ids; null if none surfaced. */
  best_rank: number | null;
}

export interface SensorCaseResult {
  name: string;
  expect_fire_ids: string[];
  fired_ids: string[];
  hits: string[];
  misses: string[];
  recall: number;
}

export interface RetrievalAggregate {
  cases: RetrievalCaseResult[];
  mean_precision: number;
  mean_recall: number;
  /** Mean reciprocal rank of the first expected hit — rewards ranking the right memory high. */
  mrr: number;
}

export interface SensorAggregate {
  cases: SensorCaseResult[];
  catch_rate: number;
}

export interface EvalReport {
  retrieval: RetrievalAggregate | null;
  sensors: SensorAggregate | null;
  /** Overall quality score 0..100. */
  score: number;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function uniq(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Score one retrieval case from the (ranked) ids the briefing surfaced.
 * `surfacedRanked` should already be capped to the top-k the caller cares about.
 */
export function scoreRetrievalCase(
  name: string,
  expectIds: string[],
  surfacedRanked: string[],
): RetrievalCaseResult {
  const expect = uniq(expectIds);
  const surfaced = uniq(surfacedRanked);
  const surfacedSet = new Set(surfaced);
  const hits = expect.filter((id) => surfacedSet.has(id));
  const misses = expect.filter((id) => !surfacedSet.has(id));

  let bestRank: number | null = null;
  for (let i = 0; i < surfaced.length; i++) {
    if (expect.includes(surfaced[i]!)) {
      bestRank = i + 1;
      break;
    }
  }

  return {
    name,
    expect_ids: expect,
    surfaced_ids: surfaced,
    hits,
    misses,
    precision: surfaced.length === 0 ? 0 : round3(hits.length / surfaced.length),
    recall: expect.length === 0 ? 1 : round3(hits.length / expect.length),
    best_rank: bestRank,
  };
}

export function aggregateRetrieval(cases: RetrievalCaseResult[]): RetrievalAggregate {
  const n = cases.length;
  const mean = (sel: (c: RetrievalCaseResult) => number): number =>
    n === 0 ? 0 : round3(cases.reduce((s, c) => s + sel(c), 0) / n);
  return {
    cases,
    mean_precision: mean((c) => c.precision),
    mean_recall: mean((c) => c.recall),
    mrr: mean((c) => (c.best_rank ? 1 / c.best_rank : 0)),
  };
}

export function scoreSensorCase(
  name: string,
  expectFireIds: string[],
  firedIds: string[],
): SensorCaseResult {
  const expect = uniq(expectFireIds);
  const fired = uniq(firedIds);
  const firedSet = new Set(fired);
  const hits = expect.filter((id) => firedSet.has(id));
  const misses = expect.filter((id) => !firedSet.has(id));
  return {
    name,
    expect_fire_ids: expect,
    fired_ids: fired,
    hits,
    misses,
    recall: expect.length === 0 ? 1 : round3(hits.length / expect.length),
  };
}

export function aggregateSensors(cases: SensorCaseResult[]): SensorAggregate {
  const totalExpected = cases.reduce((s, c) => s + c.expect_fire_ids.length, 0);
  const totalHits = cases.reduce((s, c) => s + c.hits.length, 0);
  return {
    cases,
    catch_rate: totalExpected === 0 ? 1 : round3(totalHits / totalExpected),
  };
}

/** Combine retrieval + sensor aggregates into a single 0..100 quality score. */
export function overallScore(
  retrieval: RetrievalAggregate | null,
  sensors: SensorAggregate | null,
): number {
  if (retrieval && sensors) {
    return Math.round((0.5 * retrieval.mean_recall + 0.2 * retrieval.mrr + 0.3 * sensors.catch_rate) * 100);
  }
  if (retrieval) {
    return Math.round((0.7 * retrieval.mean_recall + 0.3 * retrieval.mrr) * 100);
  }
  if (sensors) {
    return Math.round(sensors.catch_rate * 100);
  }
  return 0;
}

export function buildReport(
  retrieval: RetrievalAggregate | null,
  sensors: SensorAggregate | null,
): EvalReport {
  return { retrieval, sensors, score: overallScore(retrieval, sensors) };
}

/**
 * Baseline / compare — makes the "hAIve improves retrieval by N%" claim reproducible.
 *
 * `haive eval --baseline` snapshots a report; `--compare` re-runs and diffs against it,
 * so a ranking/sensor regression is a number, not a vibe. Pure math here; the CLI does I/O.
 */
export interface MetricDelta {
  baseline: number;
  current: number;
  /** current − baseline (positive = improvement for all these metrics). */
  delta: number;
}

export interface EvalDelta {
  score: MetricDelta;
  mean_recall: MetricDelta | null;
  mrr: MetricDelta | null;
  catch_rate: MetricDelta | null;
  /** True when the overall score dropped vs the baseline. */
  regressed: boolean;
  /** True when the overall score rose vs the baseline. */
  improved: boolean;
}

function metricDelta(baseline: number, current: number): MetricDelta {
  return { baseline: round3(baseline), current: round3(current), delta: round3(current - baseline) };
}

/** Diff a current report against a baseline. Pure. */
export function compareEvalReports(baseline: EvalReport, current: EvalReport): EvalDelta {
  const recall =
    baseline.retrieval && current.retrieval
      ? metricDelta(baseline.retrieval.mean_recall, current.retrieval.mean_recall)
      : null;
  const mrr =
    baseline.retrieval && current.retrieval
      ? metricDelta(baseline.retrieval.mrr, current.retrieval.mrr)
      : null;
  const catchRate =
    baseline.sensors && current.sensors
      ? metricDelta(baseline.sensors.catch_rate, current.sensors.catch_rate)
      : null;
  return {
    score: metricDelta(baseline.score, current.score),
    mean_recall: recall,
    mrr,
    catch_rate: catchRate,
    regressed: current.score < baseline.score,
    improved: current.score > baseline.score,
  };
}

/** Extract a short task-like title from a memory body (first heading or first line). */
export function titleFromBody(body: string): string {
  const lines = body.split("\n");
  for (const line of lines) {
    const heading = /^#+\s*(.+)$/.exec(line.trim());
    if (heading) return heading[1]!.trim().slice(0, 120);
  }
  for (const line of lines) {
    const t = line.trim();
    if (t) return t.replace(/^[-*]\s*/, "").slice(0, 120);
  }
  return "";
}

export interface SelfEvalOptions {
  /** Include each memory's anchor paths as the case files (tests anchored retrieval). */
  includeFiles?: boolean;
  /** Skip memories with these statuses (default: stale/deprecated/rejected). */
  skipStatuses?: string[];
}

/**
 * Synthesize retrieval cases from a repo's own anchored memories — zero-setup eval.
 * Each anchored, non-recap, non-dead memory becomes a case: "when working on the
 * file(s) this memory anchors, with its title as the task, does hAIve surface it?".
 * With `includeFiles: false` it becomes a harder semantic-only probe (title alone).
 */
export function synthesizeSelfEvalCases(
  memories: LoadedMemory[],
  options: SelfEvalOptions = {},
): RetrievalCase[] {
  const includeFiles = options.includeFiles ?? true;
  const skip = new Set(options.skipStatuses ?? ["stale", "deprecated", "rejected"]);
  const cases: RetrievalCase[] = [];
  for (const { memory } of memories) {
    const fm = memory.frontmatter;
    if (fm.type === "session_recap") continue;
    if (skip.has(fm.status)) continue;
    const paths = fm.anchor.paths;
    if (paths.length === 0) continue;
    const task = titleFromBody(memory.body) || fm.id;
    cases.push({
      name: fm.id,
      task,
      ...(includeFiles ? { files: paths } : {}),
      expect_ids: [fm.id],
    });
  }
  return cases;
}
