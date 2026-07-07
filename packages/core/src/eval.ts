import type { LoadedMemory } from "./loader.js";

/**
 * A rigorous, model-free, repeatable evaluation of Hivelore's core promise: surfacing
 * the right knowledge and guardrails at the right moment. Unlike the agent benchmark
 * (which parses human-written reports), this is deterministic and CI-runnable — it
 * produces a numeric quality score from labeled cases, so a regression in ranking or
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
  /**
   * Top-k precision = expected hits ÷ surfaced results. Inherently LOW when only ~1 memory is
   * expected per case but k results are surfaced (e.g. 1/8 ≈ 0.12) — this is a top-k artifact, not
   * a quality defect. Retrieval quality is judged by `mean_recall` and `mrr`; precision is NOT part
   * of the headline eval score (see `scoreEval`). Reported for completeness only.
   */
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
 * Baseline / compare — makes the "Hivelore improves retrieval by N%" claim reproducible.
 *
 * `hivelore eval --baseline` snapshots a report; `--compare` re-runs and diffs against it,
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
 * file(s) this memory anchors, with its title as the task, does Hivelore surface it?".
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

// ── Golden-set plumbing (excellence plan, Phase 5) ────────────────────────────────────────────────
// The self-synthesized eval scored 100/100 while real ranking bugs shipped. Golden cases must come
// from reality: every gate miss (a revert of a gate-passed commit) proposes a labeled retrieval
// case; a human approves it into the scored set. Plus a ranking tier CONTRACT that would have
// caught the dead-escape-hatch bug (stack packs capped at background forever).

import { classifyMemoryPriority, prioritySignals, type MemoryPriority } from "./priority.js";

/** spec.json superset: `proposed_retrieval` holds candidate cases that are NOT scored until approved. */
export interface ProposedEvalSpec extends EvalSpec {
  proposed_retrieval?: RetrievalCase[];
}

/** Merge new proposed cases into a spec.json payload (dedup by name). Returns pretty JSON. */
export function appendProposedRetrievalCases(specRaw: string | null, cases: RetrievalCase[]): string {
  let spec: ProposedEvalSpec = {};
  if (specRaw?.trim()) {
    try { spec = JSON.parse(specRaw) as ProposedEvalSpec; } catch { spec = {}; }
  }
  const existingNames = new Set([
    ...(spec.retrieval ?? []).map((c) => c.name),
    ...(spec.proposed_retrieval ?? []).map((c) => c.name),
  ]);
  const fresh = cases.filter((c) => !existingNames.has(c.name));
  if (fresh.length > 0) spec.proposed_retrieval = [...(spec.proposed_retrieval ?? []), ...fresh];
  return JSON.stringify(spec, null, 2) + "\n";
}

/** Approve every proposed case into the scored `retrieval` set. */
export function approveProposedCases(specRaw: string): { raw: string; approved: number } {
  let spec: ProposedEvalSpec;
  try { spec = JSON.parse(specRaw) as ProposedEvalSpec; } catch { return { raw: specRaw, approved: 0 }; }
  const proposed = spec.proposed_retrieval ?? [];
  if (proposed.length === 0) return { raw: specRaw, approved: 0 };
  spec.retrieval = [...(spec.retrieval ?? []), ...proposed];
  delete spec.proposed_retrieval;
  return { raw: JSON.stringify(spec, null, 2) + "\n", approved: proposed.length };
}

export interface TierContractCheck {
  name: string;
  expected: MemoryPriority;
  actual: MemoryPriority;
  pass: boolean;
}

/**
 * Ranking tier contract — the DESIGNED tier for each memory category under fixed evidence,
 * exercised against the INSTALLED classifier at eval time (so a packaging/regression slip fails CI,
 * not just the repo's own unit tests). This family is exactly what would have caught the
 * stack-pack dead-escape-hatch bug (see 2026-07-04-decision-stack-pack-rescue-strong-task-evidence).
 */
export function runTierContract(): TierContractCheck[] {
  const cases: Array<{ name: string; expected: MemoryPriority; signals: Parameters<typeof classifyMemoryPriority>[0] }> = [
    {
      name: "stack-pack seed + strong task evidence → useful (rescue path stays alive)",
      expected: "useful",
      signals: prioritySignals({ type: "convention", tags: ["stack-pack"], strongSemantic: true, usefulSemantic: true }),
    },
    {
      name: "stack-pack seed + weak evidence → background (crowding guard stays)",
      expected: "background",
      signals: prioritySignals({ type: "convention", tags: ["stack-pack"], usefulSemantic: true, tagTaskMatch: true }),
    },
    {
      name: "env workaround + strong evidence → background (hard cap stays)",
      expected: "background",
      signals: prioritySignals({ type: "gotcha", tags: ["dev-env"], strongSemantic: true, exactTaskMatch: true }),
    },
    {
      name: "direct anchor → must_read (anchors always win)",
      expected: "must_read",
      signals: prioritySignals({ type: "convention", directAnchor: true }),
    },
    {
      name: "attempt + exact task match → must_read (negative knowledge first)",
      expected: "must_read",
      signals: prioritySignals({ type: "attempt", exactTaskMatch: true }),
    },
  ];
  return cases.map(({ name, expected, signals }) => {
    const actual = classifyMemoryPriority(signals);
    return { name, expected, actual, pass: actual === expected };
  });
}

import { judgeProposedSensor, isHarnessErrorOutput } from "./sensors.js";
import { suggestSensorSeed } from "./sensor-suggest.js";
import type { Sensor } from "./types.js";

export interface ContractCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

/**
 * Validation contract — the deterministic-honesty invariants the block decision depends on, frozen
 * as fixed cases and exercised against the INSTALLED validator at eval time. Each case is a bug that
 * actually shipped once (see 2026-07-07 behaviour-honesty pass); if a refactor re-opens one, `eval`
 * fails in CI instead of the hole reappearing silently. This is the layer that self-tests the layer
 * everything else trusts — the answer to "the eval scored 100 while the validation had holes".
 */
export function runValidationContract(): ContractCheck[] {
  const checks: ContractCheck[] = [];
  const sensor = (pattern: string, extra: Partial<Sensor> = {}): Sensor => ({
    kind: "regex", pattern, paths: ["src/"], message: "m", severity: "block",
    autogen: false, last_fired: null, ...extra,
  });

  // 1. Inverted sensor — a pattern matching the lesson's recommended fix must be REJECTED.
  {
    const v = judgeProposedSensor(sensor("date-fns"), { currentTargets: [], badExamples: [], correctExamples: ["date-fns"] });
    checks.push({ name: "inverted sensor (fires on the recommended fix) is rejected", pass: !v.accepted && v.reason === "fires-on-correct", detail: v.reason });
  }
  // 2. A genuine discriminating sensor is still ACCEPTED (the guard must not over-reject).
  {
    const v = judgeProposedSensor(sensor("from ['\"]moment['\"]"), { currentTargets: [], badExamples: ["import x from 'moment'"], correctExamples: ["date-fns"] });
    checks.push({ name: "legitimate sensor (targets the mistake) is accepted", pass: v.accepted, detail: v.reason });
  }
  // 3. A sensor firing on the CURRENT correct code is rejected.
  {
    const v = judgeProposedSensor(sensor("stripe\\.create"), { currentTargets: [{ path: "src/a.ts", content: "stripe.create({ idempotencyKey })" }], badExamples: [] });
    checks.push({ name: "sensor firing on current correct code is rejected", pass: !v.accepted && v.reason === "fires-on-current", detail: v.reason });
  }
  // 4. prove-RED honesty — a harness/load error is NOT a demonstrated RED; a real assertion is.
  checks.push({ name: "harness error (missing module) is not counted as a RED", pass: isHarnessErrorOutput("Error: Cannot find module '../x'") === true });
  checks.push({ name: "a genuine assertion failure IS a real RED", pass: isHarnessErrorOutput("AssertionError: expected 100 to equal 50") === false });
  // 5. The seed never suggests the recommended tool as the pattern.
  {
    const seed = suggestSensorSeed("# use moment\n\n**Why it failed / do NOT use:** team standard is date-fns\n\n**Instead, use:** date-fns", ["src/"]);
    checks.push({ name: "seed does not suggest the recommended tool as the pattern", pass: seed?.pattern !== "date-fns", detail: seed?.pattern });
  }
  return checks;
}
