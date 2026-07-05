import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { estimateTokens, findProjectRoot } from "@hivelore/core";
import { ui } from "../utils/ui.js";

interface BenchmarkOptions {
  dir?: string;
  out?: string;
  json?: boolean;
}

interface AgentBenchmarkRow {
  fixture: string;
  group: "haive" | "plain" | "unknown";
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
}

export function registerBenchmark(program: Command): void {
  const benchmark = program
    .command("benchmark")
    .description("Measure Hivelore's VALUE: paired Hivelore-vs-plain agent runs (correctness, tokens, tools). Different from `selftest` (which only checks local install latency).");

  benchmark
    .command("report")
    .description("Summarize BENCHMARK_AGENT_REPORT.md files from a paired Hivelore/plain agent benchmark.")
    .option("-d, --dir <dir>", "benchmark root", "benchmarks/agent-benchmark")
    .option("--out <file>", "write a Markdown report")
    .option("--json", "emit JSON", false)
    .action(async (opts: BenchmarkOptions) => {
      const root = resolveBenchmarkRoot(opts.dir);
      const rows = await collectRows(root);
      const summary = summarizeRows(rows);

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
        "1. Create paired fixtures: one `*-haive`, one `*-plain`.",
        "2. Put the same failing tests in both fixtures.",
        "3. Add precise `.ai/memories/team/*.md` policy memories only to the Hivelore fixture.",
        "4. Run equal agents in parallel:",
        "   - Hivelore agents must run `hivelore briefing --files ... --task ...` first.",
        "   - Plain agents must not read `.ai` or call Hivelore.",
        "5. Require every agent to write `BENCHMARK_AGENT_REPORT.md`.",
        "   Its `## Outcome` section must include: Task completed, Tests passed, Policy violations, Duration seconds, Total tokens.",
        "6. Run `hivelore benchmark report --dir <benchmark-root> --out RESULTS.md`.",
        "7. Do not make comparative claims until evidence_grade=decision-ready (>=10 paired tasks with complete outcomes).",
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
  const group = fixture.endsWith("-haive") ? "haive" : fixture.endsWith("-plain") ? "plain" : "unknown";
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
  };
}

function summarizeRows(rows: AgentBenchmarkRow[]) {
  const byGroup = (group: AgentBenchmarkRow["group"]) => rows.filter((r) => r.group === group);
  const haiveRows = byGroup("haive");
  const plainRows = byGroup("plain");
  const taskName = (fixture: string): string => fixture.replace(/-(haive|plain)$/, "");
  const plainTasks = new Set(plainRows.map((row) => taskName(row.fixture)));
  const pairedTasks = new Set(haiveRows.map((row) => taskName(row.fixture)).filter((name) => plainTasks.has(name))).size;
  const outcomeComplete = rows.length > 0 && rows.every((row) =>
    row.task_completed !== null && row.tests_passed !== null && row.policy_violations !== null &&
    row.duration_seconds !== null && row.total_tokens !== null,
  );
  const decisionReady = pairedTasks >= 10 && outcomeComplete;
  return {
    fixtures: rows.length,
    paired_tasks: pairedTasks,
    evidence_grade: decisionReady ? "decision-ready" : "insufficient",
    evidence_reason: decisionReady
      ? "At least 10 paired tasks with complete correctness, policy, duration, and token outcomes."
      : `Need >=10 paired tasks and complete Outcome fields; found ${pairedTasks} pair(s), outcome_complete=${outcomeComplete}.`,
    haive: summarizeGroup(haiveRows),
    plain: summarizeGroup(plainRows),
  };
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
    groupLine("Plain", summary.plain),
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
  return match?.[1]?.trim() ?? null;
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
  return Number.isFinite(parsed) ? parsed : null;
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
