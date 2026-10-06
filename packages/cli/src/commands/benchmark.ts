import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { assessBenchmarkEvidence, type BenchmarkProtocolRun, estimateTokens, findProjectRoot } from "@hivelore/core";
import { ui } from "../utils/ui.js";

interface BenchmarkOptions {
  dir?: string;
  out?: string;
  json?: boolean;
}

interface AgentBenchmarkRow {
  fixture: string;
  group: "haive" | "plain" | "context" | "unknown";
  commands: number;
  files_read: number;
  files_modified: number;
  test_iterations: number;
  terminal_failures: number;
  decision_mentions: number;
  report_tokens_est: number;
  haive_impact: boolean;
  task_completed: boolean | null;
  tests_passed: boolean | null;
  policy_violations: number | null;
  duration_seconds: number | null;
  total_tokens: number | null;
  runner_id: string | null;
  model: string | null;
  checkout: string | null;
  budget: string | null;
  prompt_hash: string | null;
  human_interventions: number | null;
  evaluator_id: string | null;
  independent_evaluation: boolean | null;
}

export function registerBenchmark(program: Command): void {
  const benchmark = program
    .command("benchmark")
    .description("Measure Hivelore's VALUE: paired Hivelore-vs-plain agent runs (correctness, tokens, tools). Different from `selftest` (which only checks local install latency).");

  benchmark.command("prepare")
    .description("Prepare a balanced three-arm, repeated comparison against a documented AGENTS.md baseline")
    .requiredOption("--suite <file>", "JSON suite with cases: [{id, ...}]")
    .requiredOption("--model <name>", "identical model for all arms")
    .requiredOption("--out <directory>", "new output directory")
    .option("--repeats <n>", "repetitions per task", "3")
    .option("--budget <tokens>", "identical token budget per run", "50000")
    .action(async (opts: { suite: string; model: string; out: string; repeats: string; budget: string }) => {
      const suite = JSON.parse(await readFile(opts.suite, "utf8")) as { cases: Array<{ id: string }> };
      const repeats = Number(opts.repeats), budget = Number(opts.budget);
      if (!Array.isArray(suite.cases) || !suite.cases.length || !Number.isInteger(repeats) || repeats < 2 || repeats > 20 || !Number.isInteger(budget) || budget <= 0) throw new Error("Require cases, 2–20 repetitions and a positive token budget.");
      if (new Set(suite.cases.map(task => task.id)).size !== suite.cases.length) throw new Error("Case IDs must be unique.");
      if (existsSync(opts.out)) throw new Error("Output already exists; choose a new directory to preserve results.");
      const checkout = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
      const arms = ["plain", "context", "haive"] as const;
      const runs = suite.cases.flatMap((task, index) => {
        if (!/^[a-zA-Z0-9_-]+$/.test(task.id)) throw new Error("Case IDs must be safe directory names.");
        return Array.from({ length: repeats }, (_, repetition) => arms.map((_, position) => ({
          task: task.id, repetition: repetition + 1, arm: arms[(position + repetition + index) % 3]!,
          model: opts.model, checkout, budget, case_hash: createHash("sha256").update(JSON.stringify(task)).digest("hex"),
        }))).flat();
      });
      await mkdir(opts.out, { recursive: true });
      for (const run of runs) {
        const dir = path.join(opts.out, `${run.task}-r${run.repetition}-${run.arm}`);
        await mkdir(dir);
        await writeFile(path.join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
        await writeFile(path.join(dir, "BENCHMARK_AGENT_REPORT.md"), `# Agent report\n\n## Outcome\n- Model: ${run.model}\n- Checkout: ${run.checkout}\n- Budget: ${run.budget}\n- Prompt hash: TODO\n- Task completed: TODO\n- Tests passed: TODO\n- Policy violations: TODO\n- Duration seconds: TODO\n- Total tokens: TODO\n- Human interventions: TODO\n- Runner ID: TODO\n- Evaluator ID: TODO\n- Independent evaluation: no\n`);
      }
      await writeFile(path.join(opts.out, "protocol.json"), JSON.stringify({ version: 1, repeats, runs,
        baseline: "Same source, task, knowledge, tests and tools. Plain receives a good AGENTS.md and local search; context adds retrieval; haive adds validated gates. Use isolated checkouts and blind independent evaluation. Never train on the held-out oracle." }, null, 2));
      console.log(JSON.stringify({ prepared_runs: runs.length, evidence_grade: "insufficient", next: "Execute each run with the same runner, record telemetry and independent outcomes, then benchmark report." }));
    });

  benchmark
    .command("report")
    .description("Summarize BENCHMARK_AGENT_REPORT.md files from a paired Hivelore/plain agent benchmark.")
    .option("-d, --dir <dir>", "benchmark root", "benchmarks/agent-benchmark")
    .option("--out <file>", "write a Markdown report")
    .option("--json", "emit JSON", false)
    .action(async (opts: BenchmarkOptions) => {
      const root = resolveBenchmarkRoot(opts.dir);
      const rows = await collectRows(root);
      let protocol: BenchmarkProtocolRun[] | undefined;
      try {
        const parsed = JSON.parse(await readFile(path.join(root, "protocol.json"), "utf8"));
        if (parsed.version === 1 && Array.isArray(parsed.runs)) {
          protocol = parsed.runs;
          // Every per-run manifest must still match the planned run. Missing arms are not a new protocol.
          for (const run of protocol!) {
            if (!run || typeof run.task !== "string" || !/^[a-zA-Z0-9_-]+$/.test(run.task) || !["plain", "context", "haive"].includes(run.arm) || !Number.isInteger(run.repetition)) throw new Error("Invalid run");
            const manifest = JSON.parse(await readFile(path.join(root, `${run.task}-r${run.repetition}-${run.arm}`, "run.json"), "utf8"));
            if (["task", "repetition", "arm", "model", "checkout", "budget", "case_hash"].some(k => manifest[k] !== run[k as keyof BenchmarkProtocolRun])) throw new Error("Run manifest changed");
          }
        }
      } catch { protocol = undefined; }
      const summary = summarizeRows(rows, protocol);

      if (opts.json) {
        console.log(JSON.stringify({ root, summary, rows }, null, 2));
        return;
      }

      const markdown = renderMarkdown(root, summary, rows);
      if (opts.out) {
        const outFile = path.isAbsolute(opts.out) ? opts.out : path.join(root, opts.out);
        await writeFile(outFile, markdown, "utf8");
        ui.success(`wrote ${path.relative(process.cwd(), outFile)}`);
        return;
      }
      console.log(markdown);
    });

  benchmark
    .command("demo")
    .description("Print the recommended protocol for running a Hivelore vs plain agent benchmark.")
    .action(() => {
      console.log([
        "# Hivelore Agent Benchmark Demo",
        "",
        "1. Prepare a suite of at least 10 held-out tasks with benchmark prepare --suite suite.json --model <model> --out runs.",
        "2. Give every arm the same repository, task, domain knowledge, tests, model and budget.",
        "3. Plain uses a good AGENTS.md; context adds retrieval; haive adds validated gates.",
        "4. Execute the balanced order in protocol.json in isolated checkouts, at least three repetitions per task.",
        "5. Record complete outcomes and runner telemetry; use a blind evaluator distinct from the runner.",
        "6. Run hivelore benchmark report --dir runs --out RESULTS.md.",
        "7. Decision-ready is an evidence-completeness threshold, not proof of statistical superiority.",
        "",
        "Recommended metrics: pass rate, test iterations, files read, files changed, visible artifacts, decision quality, and token proxy.",
      ].join("\n"));
    });
}

function resolveBenchmarkRoot(dir: string | undefined): string {
  const candidate = dir ?? "benchmarks/agent-benchmark";
  if (path.isAbsolute(candidate)) return candidate;
  const projectRoot = findProjectRoot(process.cwd());
  return path.join(projectRoot, candidate);
}

async function collectRows(root: string): Promise<AgentBenchmarkRow[]> {
  if (!existsSync(root)) throw new Error(`Benchmark directory not found: ${root}`);
  const entries = await readdir(root, { withFileTypes: true });
  const rows: AgentBenchmarkRow[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fixtureDir = path.join(root, entry.name);
    const reportFile = path.join(fixtureDir, "BENCHMARK_AGENT_REPORT.md");
    if (!existsSync(reportFile)) continue;
    const report = await readFile(reportFile, "utf8");
    rows.push(parseAgentReport(entry.name, report));
  }
  return rows.sort((a, b) => a.fixture.localeCompare(b.fixture));
}

function parseAgentReport(fixture: string, report: string): AgentBenchmarkRow {
  const group = fixture.endsWith("-haive") ? "haive" : fixture.endsWith("-plain") ? "plain" : fixture.endsWith("-context") ? "context" : "unknown";
  return {
    fixture,
    group,
    commands: sectionBulletCount(report, "Commands"),
    files_read: sectionBulletCount(report, "Files Read"),
    files_modified: sectionBulletCount(report, "Files Modified"),
    test_iterations: countMatches(section(report, "Test Iterations"), /Iteration\s+\d+|^- /gim),
    terminal_failures: countMatches(section(report, "Terminal Errors"), /fail|error|not raised|exited with code 1/gi),
    decision_mentions: sectionBulletCount(report, "Key Decisions"),
    report_tokens_est: estimateTokens(report),
    haive_impact: /Hivelore Memory Impact[\s\S]*?\b(yes|directly|changed|shaped|confirmed)\b/i.test(report),
    task_completed: reportBoolean(report, "Task completed"),
    tests_passed: reportBoolean(report, "Tests passed"),
    policy_violations: reportNumber(report, "Policy violations"),
    duration_seconds: reportNumber(report, "Duration seconds"),
    total_tokens: reportNumber(report, "Total tokens"),
    runner_id: reportValue(report, "Runner ID"),
    model: reportValue(report, "Model"), checkout: reportValue(report, "Checkout"),
    budget: reportValue(report, "Budget"), prompt_hash: reportValue(report, "Prompt hash"),
    human_interventions: reportNumber(report, "Human interventions"),
    evaluator_id: reportValue(report, "Evaluator ID"),
    independent_evaluation: reportBoolean(report, "Independent evaluation"),
  };
}

function summarizeRows(rows: AgentBenchmarkRow[], protocol?: BenchmarkProtocolRun[]) {
  return { fixtures: rows.length, ...assessBenchmarkEvidence(rows, protocol),
    context: summarizeGroup(rows.filter(r => r.group === "context")),
    haive: summarizeGroup(rows.filter(r => r.group === "haive")),
    plain: summarizeGroup(rows.filter(r => r.group === "plain")) };
}

function summarizeGroup(rows: AgentBenchmarkRow[]) {
  const sum = (key: keyof AgentBenchmarkRow): number =>
    rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  return {
    fixtures: rows.length,
    commands: sum("commands"),
    files_read: sum("files_read"),
    files_modified: sum("files_modified"),
    test_iterations: sum("test_iterations"),
    terminal_failures: sum("terminal_failures"),
    decision_mentions: sum("decision_mentions"),
    report_tokens_est: sum("report_tokens_est"),
    haive_impact_count: rows.filter((r) => r.haive_impact).length,
    completed: rows.filter((r) => r.task_completed === true).length,
    tests_passed: rows.filter((r) => r.tests_passed === true).length,
    policy_violations: rows.reduce((total, row) => total + (row.policy_violations ?? 0), 0),
    duration_seconds: rows.reduce((total, row) => total + (row.duration_seconds ?? 0), 0),
    total_tokens: rows.reduce((total, row) => total + (row.total_tokens ?? 0), 0),
  };
}

function renderMarkdown(
  root: string,
  summary: ReturnType<typeof summarizeRows>,
  rows: AgentBenchmarkRow[],
): string {
  const lines = [
    "# Hivelore Agent Benchmark Report",
    "",
    `Benchmark root: \`${root}\``,
    "",
    "## Summary",
    "",
    `Evidence grade: **${summary.evidence_grade}** — ${summary.evidence_reason}`,
    "",
    "| Group | Fixtures | Commands | Files read | Files modified | Test iterations | Terminal failures | Decision mentions | Report tokens (est, report only) | Hivelore impact |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    groupLine("Hivelore", summary.haive),
    groupLine("Plain (AGENTS.md)", summary.plain),
    groupLine("Context only", summary.context),
    "",
    "## Fixtures",
    "",
    "| Fixture | Group | Commands | Files read | Files modified | Test iterations | Terminal failures | Decisions | Report tokens (est, report only) | Hivelore impact |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) =>
      `| \`${row.fixture}\` | ${row.group} | ${row.commands} | ${row.files_read} | ${row.files_modified} | ${row.test_iterations} | ${row.terminal_failures} | ${row.decision_mentions} | ${row.report_tokens_est} | ${row.haive_impact ? "yes" : "no"} |`,
    ),
    "",
    "## Reading",
    "",
    "`Report tokens (est)` estimates the size of the agent's WRITTEN REPORT only — a verbosity proxy, NOT",
    "the agent's total token consumption. For real per-agent token/latency, capture your runner's telemetry",
    "(e.g. subagent token counts) separately; this report can't see model billing.",
    "Use this report to compare relative effort and decision quality, then pair it with final test results and a human review of the diffs.",
    "",
  ];
  return lines.join("\n");
}

function reportValue(report: string, label: string): string | null {
  const match = new RegExp(`^[-*]\\s*${escapeRegExp(label)}\\s*:\\s*(.+)$`, "im").exec(report);
  const value = match?.[1]?.trim();
  return value && value !== "TODO" ? value : null;
}

function reportBoolean(report: string, label: string): boolean | null {
  const value = reportValue(report, label);
  if (!value) return null;
  if (/^(yes|true|pass|passed|complete|completed)$/i.test(value)) return true;
  if (/^(no|false|fail|failed|incomplete)$/i.test(value)) return false;
  return null;
}

function reportNumber(report: string, label: string): number | null {
  const value = reportValue(report, label);
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function groupLine(label: string, group: ReturnType<typeof summarizeGroup>): string {
  return `| ${label} | ${group.fixtures} | ${group.commands} | ${group.files_read} | ${group.files_modified} | ${group.test_iterations} | ${group.terminal_failures} | ${group.decision_mentions} | ${group.report_tokens_est} | ${group.haive_impact_count} |`;
}

function sectionBulletCount(markdown: string, title: string): number {
  return countMatches(section(markdown, title), /^- |^\d+\.\s/gm);
}

function section(markdown: string, title: string): string {
  const re = new RegExp(`##\\s+[^\\n]*${escapeRegExp(title)}[^\\n]*\\n([\\s\\S]*?)(?=\\n##\\s+|$)`, "i");
  return re.exec(markdown)?.[1] ?? "";
}

function countMatches(text: string, re: RegExp): number {
  return [...text.matchAll(re)].length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
