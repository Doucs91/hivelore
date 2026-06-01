import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  aggregateRetrieval,
  aggregateSensors,
  buildReport,
  findProjectRoot,
  resolveHaivePaths,
  scoreRetrievalCase,
  scoreSensorCase,
  synthesizeSelfEvalCases,
  type EvalSpec,
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
  dir?: string;
}

export function registerEval(program: Command): void {
  program
    .command("eval")
    .description(
      "Rigorous, repeatable quality eval: do the right memories surface (retrieval) and " +
        "do the right sensors fire (catch-rate)? Emits a chiffré 0–100 score. " +
        "Uses .ai/eval cases via --spec, or auto-synthesizes cases from anchored memories.",
    )
    .option("--spec <file>", "JSON eval spec ({ retrieval: [...], sensors: [...] })")
    .option("--semantic-only", "self-eval probes by title alone (no anchor files) — harder retrieval", false)
    .option("-k, --top <n>", "briefing top-k considered a hit", "8")
    .option("--json", "emit JSON", false)
    .option("--out <file>", "write a Markdown report")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: EvalOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }
      const k = Math.max(1, parseInt(opts.top ?? "8", 10) || 8);
      const ctx = { paths };

      const spec = await resolveSpec(opts, paths.memoriesDir);
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

      if (opts.json) {
        console.log(JSON.stringify({ root, k, report }, null, 2));
        return;
      }

      const md = renderMarkdown(root, k, report);
      if (opts.out) {
        const outFile = path.isAbsolute(opts.out) ? opts.out : path.join(root, opts.out);
        await writeFile(outFile, md, "utf8");
        ui.success(`wrote ${path.relative(process.cwd(), outFile)}`);
        return;
      }
      console.log(md);
    });
}

async function resolveSpec(opts: EvalOptions, memoriesDir: string): Promise<EvalSpec> {
  if (opts.spec) {
    const file = path.resolve(opts.spec);
    const raw = await readFile(file, "utf8");
    return JSON.parse(raw) as EvalSpec;
  }
  const memories = await loadMemoriesFromDir(memoriesDir);
  return { retrieval: synthesizeSelfEvalCases(memories, { includeFiles: !opts.semanticOnly }) };
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

function renderMarkdown(root: string, k: number, report: ReturnType<typeof buildReport>): string {
  const lines = [
    "# hAIve eval report",
    "",
    `Project: \`${root}\` · top-k: ${k}`,
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
      `- mean recall: ${pct(r.mean_recall)}`,
      `- mean precision: ${pct(r.mean_precision)}`,
      `- MRR: ${r.mrr.toFixed(3)}`,
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
    "## Reading",
    "",
    "Retrieval recall = share of expected memories that surfaced in the briefing top-k.",
    "MRR rewards ranking the right memory high. Catch-rate = share of known-bad diffs a sensor flagged.",
    "Run in CI to fail the build on a ranking/sensor regression.",
    "",
  );
  return lines.join("\n");
}
