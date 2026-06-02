import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { estimateTokens, findProjectRoot } from "@hiveai/core";
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
  token_proxy: number;
  haive_impact: boolean;
}

export function registerBenchmark(program: Command): void {
  const benchmark = program
    .command("benchmark")
    .description("Measure hAIve's VALUE: paired hAIve-vs-plain agent runs (correctness, tokens, tools). Different from `selftest` (which only checks local install latency).");

  benchmark
    .command("report")
    .description("Summarize BENCHMARK_AGENT_REPORT.md files from a paired hAIve/plain agent benchmark.")
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
    .description("Print the recommended protocol for running a hAIve vs plain agent benchmark.")
    .action(() => {
      console.log([
        "# hAIve Agent Benchmark Demo",
        "",
        "1. Create paired fixtures: one `*-haive`, one `*-plain`.",
        "2. Put the same failing tests in both fixtures.",
        "3. Add precise `.ai/memories/team/*.md` policy memories only to the hAIve fixture.",
        "4. Run equal agents in parallel:",
        "   - hAIve agents must run `haive briefing --files ... --task ...` first.",
        "   - Plain agents must not read `.ai` or call hAIve.",
        "5. Require every agent to write `BENCHMARK_AGENT_REPORT.md`.",
        "6. Run `haive benchmark report --dir <benchmark-root> --out RESULTS.md`.",
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
    token_proxy: estimateTokens(report),
    haive_impact: /hAIve Memory Impact[\s\S]*?\b(yes|directly|changed|shaped|confirmed)\b/i.test(report),
  };
}

function summarizeRows(rows: AgentBenchmarkRow[]) {
  const byGroup = (group: AgentBenchmarkRow["group"]) => rows.filter((r) => r.group === group);
  return {
    fixtures: rows.length,
    haive: summarizeGroup(byGroup("haive")),
    plain: summarizeGroup(byGroup("plain")),
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
    token_proxy: sum("token_proxy"),
    haive_impact_count: rows.filter((r) => r.haive_impact).length,
  };
}

function renderMarkdown(
  root: string,
  summary: ReturnType<typeof summarizeRows>,
  rows: AgentBenchmarkRow[],
): string {
  const lines = [
    "# hAIve Agent Benchmark Report",
    "",
    `Benchmark root: \`${root}\``,
    "",
    "## Summary",
    "",
    "| Group | Fixtures | Commands | Files read | Files modified | Test iterations | Terminal failures | Decision mentions | Token proxy | hAIve impact |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    groupLine("hAIve", summary.haive),
    groupLine("Plain", summary.plain),
    "",
    "## Fixtures",
    "",
    "| Fixture | Group | Commands | Files read | Files modified | Test iterations | Terminal failures | Decisions | Token proxy | hAIve impact |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
    ...rows.map((row) =>
      `| \`${row.fixture}\` | ${row.group} | ${row.commands} | ${row.files_read} | ${row.files_modified} | ${row.test_iterations} | ${row.terminal_failures} | ${row.decision_mentions} | ${row.token_proxy} | ${row.haive_impact ? "yes" : "no"} |`,
    ),
    "",
    "## Reading",
    "",
    "The token proxy is estimated from the agent report size, not from private model billing data.",
    "Use this report to compare relative effort and decision quality, then pair it with final test results and a human review of the diffs.",
    "",
  ];
  return lines.join("\n");
}

function groupLine(label: string, group: ReturnType<typeof summarizeGroup>): string {
  return `| ${label} | ${group.fixtures} | ${group.commands} | ${group.files_read} | ${group.files_modified} | ${group.test_iterations} | ${group.terminal_failures} | ${group.decision_mentions} | ${group.token_proxy} | ${group.haive_impact_count} |`;
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
