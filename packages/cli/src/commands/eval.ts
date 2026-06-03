import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  aggregateRetrieval,
  aggregateSensors,
  appendEvalHistory,
  buildReport,
  compareGatePrecision,
  compareEvalReports,
  computeGatePrecision,
  computeEvalTrend,
  findProjectRoot,
  loadConfig,
  loadEvalHistory,
  loadPreventionEvents,
  loadUsageIndex,
  resolveHaivePaths,
  scoreRetrievalCase,
  scoreSensorCase,
  synthesizeSelfEvalCases,
  type EvalDelta,
  type EvalReport,
  type EvalSpec,
  type GatePrecision,
  type GatePrecisionDelta,
  type RetrievalCase,
  type RetrievalCaseResult,
  type SensorCase,
  type SensorCaseResult,
} from "@hiveai/core";
import { antiPatternsCheck, getBriefing } from "@hiveai/mcp";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface EvalOptions {
  spec?: string;
  semanticOnly?: boolean;
  top?: string;
  json?: boolean;
  out?: string;
  failUnder?: string;
  failUnderCatchRate?: string;
  failUnderGatePrecision?: string;
  baseline?: boolean;
  compare?: boolean;
  baselineFile?: string;
  failOnRegression?: boolean;
  regressionGate?: boolean;
  record?: boolean;
  trend?: boolean;
  ref?: string;
  dir?: string;
}

interface BaselineSnapshot {
  saved_at: string;
  k: number;
  spec_source: string;
  report: EvalReport;
  gate_precision?: GatePrecision;
}

interface ResolvedEvalSpec {
  spec: EvalSpec;
  source: string;
}

export function registerEval(program: Command): void {
  program
    .command("eval")
    .description(
      "Rigorous, repeatable quality eval: do the right memories surface (retrieval) and " +
        "do the right sensors fire (catch-rate)? Emits a numeric 0–100 score. " +
        "Uses .ai/eval cases via --spec, or auto-synthesizes cases from anchored memories.",
    )
    .option("--spec <file>", "JSON eval spec ({ retrieval: [...], sensors: [...] })")
    .option("--semantic-only", "self-eval probes by title alone (no anchor files) — harder retrieval", false)
    .option("-k, --top <n>", "briefing top-k considered a hit", "8")
    .option("--json", "emit JSON", false)
    .option("--out <file>", "write a Markdown report")
    .option("--fail-under <score>", "exit non-zero if the overall score is below this (0–100) — for CI gates")
    .option("--fail-under-catch-rate <pct>", "exit non-zero if sensor catch-rate is below this percentage")
    .option("--fail-under-gate-precision <pct>", "exit non-zero if gate precision is below this percentage")
    .option("--baseline", "save this run as the baseline (.ai/eval/baseline.json) for future --compare", false)
    .option("--compare", "diff this run against the saved baseline and print the delta", false)
    .option("--baseline-file <path>", "baseline file to read/write (default: .ai/eval/baseline.json)")
    .option("--fail-on-regression", "with --compare, exit non-zero if the score dropped vs the baseline", false)
    .option("--regression-gate", "CI-safe gate: compare against the baseline IF one exists (fail on regression), else no-op", false)
    .option("--record", "append this run's score to .ai/.cache/eval-history.jsonl (trend the harness over time)", false)
    .option("--trend", "print the recorded score trend (sparkline + latest/best/delta) and exit", false)
    .option("--ref <ref>", "version/commit label stored with a --record run")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: EvalOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      // ── Trend view: read-only, no scoring run needed ─────────────────────
      if (opts.trend) {
        const trend = computeEvalTrend(await loadEvalHistory(paths));
        if (opts.json) {
          console.log(JSON.stringify(trend, null, 2));
          return;
        }
        if (trend.runs === 0) {
          ui.info("No eval history yet. Run `haive eval --record` to start trending the harness.");
          return;
        }
        const spark = trend.recent.map((s) => "▁▂▃▄▅▆▇█"[Math.min(7, Math.round((s / 100) * 7))]).join("");
        const arrow = trend.regressed ? ui.red("▼") : (trend.delta ?? 0) > 0 ? ui.green("▲") : ui.dim("=");
        console.log(ui.bold("hAIve eval trend"));
        console.log(`  ${spark}  latest ${arrow} ${trend.latest}/100  ${ui.dim(`(best ${trend.best}, ${trend.runs} run${trend.runs === 1 ? "" : "s"})`)}`);
        return;
      }
      const k = Math.max(1, parseInt(opts.top ?? "8", 10) || 8);
      const ctx = { paths };

      const resolvedSpec = await resolveSpec(opts, root, paths.memoriesDir);
      const spec = resolvedSpec.spec;
      if ((spec.retrieval?.length ?? 0) === 0 && (spec.sensors?.length ?? 0) === 0) {
        ui.warn("No eval cases (no anchored memories and no --spec). Nothing to score.");
        return;
      }

      // ── Retrieval cases ──────────────────────────────────────────────────
      let retrievalAgg = null;
      if (spec.retrieval && spec.retrieval.length > 0) {
        const results: RetrievalCaseResult[] = [];
        for (const c of spec.retrieval) {
          const surfaced = await runRetrieval(c, k, ctx);
          results.push(scoreRetrievalCase(c.name, c.expect_ids, surfaced));
        }
        retrievalAgg = aggregateRetrieval(results);
      }

      // ── Sensor cases ─────────────────────────────────────────────────────
      let sensorAgg = null;
      if (spec.sensors && spec.sensors.length > 0) {
        const results: SensorCaseResult[] = [];
        for (const c of spec.sensors) {
          const fired = await runSensorCase(c, ctx);
          results.push(scoreSensorCase(c.name, c.expect_fire_ids, fired));
        }
        sensorAgg = aggregateSensors(results);
      }

      const report = buildReport(retrievalAgg, sensorAgg);
      const [usage, preventionEvents, config] = await Promise.all([
        loadUsageIndex(paths),
        loadPreventionEvents(paths),
        loadConfig(paths),
      ]);
      const gatePrecision = computeGatePrecision(
        preventionEvents,
        usage,
        config.enforcement?.antiPatternGate ?? "anchored",
      );

      // ── Record to history (trend the harness over releases) ───────────────
      if (opts.record) {
        await appendEvalHistory(paths, {
          at: new Date().toISOString(),
          score: report.score,
          ...(report.retrieval ? { mean_recall: report.retrieval.mean_recall, mrr: report.retrieval.mrr } : {}),
          ...(report.sensors ? { catch_rate: report.sensors.catch_rate } : {}),
          ...(opts.ref ? { ref: opts.ref } : {}),
        }).catch(() => { /* best-effort telemetry */ });
        if (!opts.json) ui.success(`Recorded eval score ${report.score}/100 to history.`);
      }

      const baselineFile = opts.baselineFile
        ? (path.isAbsolute(opts.baselineFile) ? opts.baselineFile : path.join(root, opts.baselineFile))
        : path.join(root, ".ai", "eval", "baseline.json");

      // ── Save baseline ─────────────────────────────────────────────────────
      if (opts.baseline) {
        const snapshot: BaselineSnapshot = {
          saved_at: new Date().toISOString(),
          k,
          spec_source: resolvedSpec.source,
          report,
          gate_precision: gatePrecision,
        };
        await mkdir(path.dirname(baselineFile), { recursive: true });
        await writeFile(baselineFile, JSON.stringify(snapshot, null, 2), "utf8");
        if (!opts.json) ui.success(`Saved baseline (score ${report.score}/100) → ${path.relative(root, baselineFile)}`);
      }

      // ── Compare against baseline ──────────────────────────────────────────
      // `--regression-gate` is the CI-safe variant: it compares only when a baseline
      // exists and otherwise no-ops, so it can be dropped into any pipeline unconditionally.
      let delta: EvalDelta | null = null;
      let gateDelta: GatePrecisionDelta | null = null;
      if (opts.compare || opts.regressionGate) {
        if (!existsSync(baselineFile)) {
          if (opts.regressionGate) {
            if (!opts.json) ui.info(`No baseline at ${path.relative(root, baselineFile)} — regression gate skipped. Run \`haive eval --baseline\` to enable it.`);
          } else {
            ui.error(`No baseline at ${path.relative(root, baselineFile)}. Run \`haive eval --baseline\` first.`);
            process.exitCode = 1;
            return;
          }
        } else {
          const snapshot = JSON.parse(await readFile(baselineFile, "utf8")) as BaselineSnapshot;
          delta = compareEvalReports(snapshot.report, report);
          if (snapshot.gate_precision) {
            gateDelta = compareGatePrecision(snapshot.gate_precision, gatePrecision);
          }
        }
      }

      if (opts.json) {
        console.log(JSON.stringify({
          root,
          k,
          spec_source: resolvedSpec.source,
          report,
          gate_precision: gatePrecision,
          ...(delta ? { delta } : {}),
          ...(gateDelta ? { gate_delta: gateDelta } : {}),
        }, null, 2));
        applyExitGates(opts, report, delta, gatePrecision, gateDelta);
        return;
      }

      if (delta) {
        console.log(renderDelta(delta));
      }
      if (gateDelta) {
        console.log(renderGateDelta(gateDelta));
      }

      const md = renderMarkdown(root, k, resolvedSpec.source, report, gatePrecision);
      if (opts.out) {
        const outFile = path.isAbsolute(opts.out) ? opts.out : path.join(root, opts.out);
        await writeFile(outFile, md, "utf8");
        ui.success(`wrote ${path.relative(process.cwd(), outFile)}`);
      } else {
        console.log(md);
      }

      applyExitGates(opts, report, delta, gatePrecision, gateDelta);
    });
}

function parsePctThreshold(label: string, raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (Number.isNaN(n)) {
    ui.error(`${label} expects a number, got "${raw}"`);
    process.exitCode = 1;
    return null;
  }
  return n > 1 ? n / 100 : n;
}

/** CI gates: fail the build on absolute floors or metric regressions. */
function applyExitGates(
  opts: EvalOptions,
  report: EvalReport,
  delta: EvalDelta | null,
  gatePrecision: GatePrecision,
  gateDelta: GatePrecisionDelta | null,
): void {
  if (opts.failUnder !== undefined) {
    const threshold = Number(opts.failUnder);
    if (Number.isNaN(threshold)) {
      ui.error(`--fail-under expects a number, got "${opts.failUnder}"`);
      process.exitCode = 1;
    } else if (report.score < threshold) {
      ui.error(`eval score ${report.score} is below --fail-under ${threshold}`);
      process.exitCode = 1;
    }
  }
  const catchRateFloor = parsePctThreshold("--fail-under-catch-rate", opts.failUnderCatchRate);
  if (catchRateFloor !== null && report.sensors && report.sensors.catch_rate < catchRateFloor) {
    ui.error(`sensor catch-rate ${Math.round(report.sensors.catch_rate * 100)}% is below --fail-under-catch-rate ${Math.round(catchRateFloor * 100)}%`);
    process.exitCode = 1;
  }
  const gatePrecisionFloor = parsePctThreshold("--fail-under-gate-precision", opts.failUnderGatePrecision);
  if (
    gatePrecisionFloor !== null &&
    gatePrecision.precision !== null &&
    gatePrecision.precision < gatePrecisionFloor
  ) {
    ui.error(`gate precision ${Math.round(gatePrecision.precision * 100)}% is below --fail-under-gate-precision ${Math.round(gatePrecisionFloor * 100)}%`);
    process.exitCode = 1;
  }
  if ((opts.failOnRegression || opts.regressionGate) && delta?.regressed) {
    ui.error(`eval score regressed ${delta.score.baseline} → ${delta.score.current} (Δ ${delta.score.delta}) vs baseline`);
    process.exitCode = 1;
  }
  if ((opts.failOnRegression || opts.regressionGate) && delta?.catch_rate?.delta !== undefined && delta.catch_rate.delta < 0) {
    ui.error(`sensor catch-rate regressed ${delta.catch_rate.baseline} → ${delta.catch_rate.current} (Δ ${delta.catch_rate.delta}) vs baseline`);
    process.exitCode = 1;
  }
  if ((opts.failOnRegression || opts.regressionGate) && gateDelta?.regressed) {
    ui.error("gate precision regressed vs baseline (more false-positive rejections or lower precision)");
    process.exitCode = 1;
  }
}

function fmtDelta(label: string, m: { baseline: number; current: number; delta: number } | null): string | null {
  if (!m) return null;
  const sign = m.delta > 0 ? "+" : "";
  const arrow = m.delta > 0 ? ui.green("▲") : m.delta < 0 ? ui.red("▼") : ui.dim("=");
  return `  ${arrow} ${label.padEnd(12)} ${m.baseline} → ${m.current} ${ui.dim(`(${sign}${m.delta})`)}`;
}

function renderDelta(delta: EvalDelta): string {
  const verdict = delta.regressed ? ui.red("REGRESSED") : delta.improved ? ui.green("IMPROVED") : ui.dim("UNCHANGED");
  const lines = [ui.bold(`Eval vs baseline — ${verdict}`)];
  for (const line of [
    fmtDelta("score", delta.score),
    fmtDelta("mean recall", delta.mean_recall),
    fmtDelta("mrr", delta.mrr),
    fmtDelta("catch-rate", delta.catch_rate),
  ]) {
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

function renderGateDelta(delta: GatePrecisionDelta): string {
  const verdict = delta.regressed ? ui.red("REGRESSED") : ui.dim("UNCHANGED");
  const lines = [ui.bold(`Gate precision vs baseline — ${verdict}`)];
  const precisionDelta =
    delta.precision.delta === null ? "n/a" : `${delta.precision.delta > 0 ? "+" : ""}${delta.precision.delta}`;
  const rejectionDelta =
    delta.rejections.delta === null ? "n/a" : `${delta.rejections.delta > 0 ? "+" : ""}${delta.rejections.delta}`;
  lines.push(`  precision ${delta.precision.baseline ?? "n/a"} → ${delta.precision.current ?? "n/a"} ${ui.dim(`(${precisionDelta})`)}`);
  lines.push(`  rejections ${delta.rejections.baseline ?? "n/a"} → ${delta.rejections.current ?? "n/a"} ${ui.dim(`(${rejectionDelta})`)}`);
  return lines.join("\n");
}

async function resolveSpec(opts: EvalOptions, root: string, memoriesDir: string): Promise<ResolvedEvalSpec> {
  if (opts.spec) {
    const file = path.resolve(opts.spec);
    const raw = await readFile(file, "utf8");
    return { spec: JSON.parse(raw) as EvalSpec, source: file };
  }
  const defaultSpec = path.join(root, ".ai", "eval", "spec.json");
  if (existsSync(defaultSpec)) {
    const raw = await readFile(defaultSpec, "utf8");
    const explicit = JSON.parse(raw) as EvalSpec;
    const memories = await loadMemoriesFromDir(memoriesDir);
    const synthesized = synthesizeSelfEvalCases(memories, { includeFiles: !opts.semanticOnly });
    return {
      spec: {
        retrieval: [...synthesized, ...(explicit.retrieval ?? [])],
        sensors: explicit.sensors ?? [],
      },
      source: ".ai/eval/spec.json + synthesized anchored retrieval",
    };
  }
  const memories = await loadMemoriesFromDir(memoriesDir);
  return {
    spec: { retrieval: synthesizeSelfEvalCases(memories, { includeFiles: !opts.semanticOnly }) },
    source: "synthesized anchored retrieval",
  };
}

async function runRetrieval(
  c: RetrievalCase,
  k: number,
  ctx: { paths: ReturnType<typeof resolveHaivePaths> },
): Promise<string[]> {
  const out = await getBriefing(
    {
      task: c.task,
      files: c.files ?? [],
      symbols: c.symbols ?? [],
      max_tokens: 6000,
      max_memories: k,
      include_project_context: false,
      include_module_contexts: false,
      semantic: true,
      include_stale: false,
      track: false,
      format: "compact",
      min_semantic_score: 0,
    },
    ctx,
  );
  return out.memories.map((m) => m.id);
}

async function runSensorCase(
  c: SensorCase,
  ctx: { paths: ReturnType<typeof resolveHaivePaths> },
): Promise<string[]> {
  const out = await antiPatternsCheck(
    { diff: c.diff, paths: c.paths ?? [], limit: 50, semantic: false },
    ctx,
  );
  return out.warnings.filter((w) => w.reasons.includes("sensor")).map((w) => w.id);
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function renderMarkdown(
  root: string,
  k: number,
  source: string,
  report: ReturnType<typeof buildReport>,
  gatePrecision: GatePrecision,
): string {
  const lines = [
    "# hAIve eval report",
    "",
    `Project: \`${root}\` · top-k: ${k}`,
    `Spec: ${source}`,
    "",
    `## Overall score: ${report.score}/100`,
    "",
  ];

  if (report.retrieval) {
    const r = report.retrieval;
    lines.push(
      "## Retrieval",
      "",
      `- cases: ${r.cases.length}`,
      `- mean recall: ${pct(r.mean_recall)} ${"— did the expected memory make the top-k? (the metric that matters)"}`,
      `- mean precision: ${pct(r.mean_precision)} ${"— top-k precision (expected ÷ k surfaced); low by design when ~1 is expected per case, NOT a quality defect; excluded from the headline score"}`,
      `- MRR: ${r.mrr.toFixed(3)} — how high the expected memory was ranked`,
      "",
    );
    const misses = r.cases.filter((c) => c.misses.length > 0);
    if (misses.length > 0) {
      lines.push(`### ${misses.length} retrieval miss(es)`, "");
      for (const c of misses.slice(0, 25)) {
        lines.push(`- \`${c.name}\` — expected not in top-${k}`);
      }
      lines.push("");
    }
  }

  if (report.sensors) {
    const s = report.sensors;
    lines.push("## Sensors", "", `- cases: ${s.cases.length}`, `- catch-rate: ${pct(s.catch_rate)}`, "");
    const misses = s.cases.filter((c) => c.misses.length > 0);
    if (misses.length > 0) {
      lines.push(`### ${misses.length} sensor miss(es)`, "");
      for (const c of misses.slice(0, 25)) {
        lines.push(`- \`${c.name}\` — sensor did not fire (expected: ${c.misses.join(", ")})`);
      }
      lines.push("");
    }
  }

  lines.push(
    "## Gate precision",
    "",
    `- precision: ${gatePrecision.precision === null ? "n/a" : pct(gatePrecision.precision)}`,
    `- useful outcomes: ${gatePrecision.useful}`,
    `- rejected as false-positive/noise: ${gatePrecision.rejections}`,
    "",
  );

  lines.push(
    "## Reading",
    "",
    "Retrieval recall = share of expected memories that surfaced in the briefing top-k.",
    "MRR rewards ranking the right memory high. Catch-rate = share of known-bad diffs a sensor flagged.",
    "Run in CI to fail the build on a ranking/sensor regression.",
    "",
  );
  return lines.join("\n");
}
