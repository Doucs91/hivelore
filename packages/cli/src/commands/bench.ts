import { performance } from "node:perf_hooks";
import { Command } from "commander";
import {
  estimateTokens,
  findProjectRoot,
  resolveHaivePaths,
} from "@hiveai/core";
import {
  antiPatternsCheck,
  codeMapTool,
  codeSearch,
  getBriefing,
  getRecap,
  memRelevantTo,
} from "@hiveai/mcp";
import { ui } from "../utils/ui.js";

interface BenchOptions {
  task?: string;
  json?: boolean;
  dir?: string;
}

interface ScenarioResult {
  name: string;
  ok: boolean;
  latency_ms: number;
  payload_tokens: number;
  notes: string[];
}

export function registerBench(program: Command): void {
  program
    .command("bench")
    .description("Self-test the local hAIve setup: runs core MCP tools against this project and reports latency + payload size.")
    .option("-t, --task <task>", "task description for ranking-aware tools", "audit dependencies for security risks")
    .option("--json", "emit JSON instead of a table", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: BenchOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const ctx = { paths };
      const task = opts.task ?? "audit dependencies for security risks";

      const scenarios: Array<() => Promise<ScenarioResult>> = [
        async () => {
          const t0 = performance.now();
          const out = await getBriefing(
            {
              task,
              files: [],
              max_tokens: 4000,
              max_memories: 8,
              include_project_context: true,
              include_module_contexts: true,
              semantic: true,
              include_stale: false,
              track: false,
              format: "compact",
              symbols: [],
              min_semantic_score: 0,
            },
            ctx,
          );
          return summarize("get_briefing(compact)", t0, out, [
            out.low_value ? "low_value (cold-start)" : `${out.memories.length} memories`,
            `search=${out.search_mode}`,
          ]);
        },
        async () => {
          const t0 = performance.now();
          const out = await codeMapTool({ paths: [], max_files: 40, max_tokens: 2000 }, ctx);
          return summarize("code_map(budget=2k)", t0, out, [
            out.available ? `${out.files.length}/${out.total_files} files` : "unavailable",
            out.budget_clipped ? "clipped" : "fits",
          ]);
        },
        async () => {
          const t0 = performance.now();
          const out = await getRecap({ scope: "any" }, ctx);
          return summarize("get_recap", t0, out, [
            out.recap ? `${out.recap.id.slice(0, 30)}…` : "no recap",
          ]);
        },
        async () => {
          const t0 = performance.now();
          const out = await memRelevantTo(
            { task, files: [], limit: 8, min_semantic_score: 0.25, format: "compact" },
            ctx,
          );
          return summarize("mem_relevant_to", t0, out, [
            `${out.memories.length} memories`,
            `search=${out.search_mode}`,
          ]);
        },
        async () => {
          const t0 = performance.now();
          const out = await codeSearch({ query: task, k: 5, min_score: 0.2 }, ctx);
          return summarize("code_search", t0, out, [
            out.available ? `${out.hits.length} hits` : "needs index (haive index code-search)",
          ]);
        },
        async () => {
          const t0 = performance.now();
          const out = await antiPatternsCheck({ diff: task, paths: [], limit: 5, semantic: true }, ctx);
          return summarize("anti_patterns_check", t0, out, [
            `${out.warnings.length}/${out.scanned} warn`,
          ]);
        },
      ];

      const results: ScenarioResult[] = [];
      for (const run of scenarios) {
        try {
          results.push(await run());
        } catch (err) {
          results.push({
            name: "(error)",
            ok: false,
            latency_ms: 0,
            payload_tokens: 0,
            notes: [err instanceof Error ? err.message : String(err)],
          });
        }
      }

      if (opts.json) {
        console.log(JSON.stringify({ root, task, scenarios: results }, null, 2));
        return;
      }

      console.log(ui.bold(`hAIve bench — ${root}`));
      console.log(ui.dim(`task: ${task}`));
      console.log();
      console.log(
        `${"scenario".padEnd(28)} ${"latency".padStart(8)}  ${"tokens".padStart(7)}  notes`,
      );
      console.log("─".repeat(88));
      for (const r of results) {
        const status = r.ok ? ui.green("✓") : ui.red("✗");
        console.log(
          `${status} ${r.name.padEnd(26)} ${`${r.latency_ms.toFixed(0)} ms`.padStart(8)}  ${String(r.payload_tokens).padStart(7)}  ${r.notes.join("; ")}`,
        );
      }

      const totalTokens = results.reduce((s, r) => s + r.payload_tokens, 0);
      const totalMs = results.reduce((s, r) => s + r.latency_ms, 0);
      console.log("─".repeat(88));
      console.log(
        `${ui.dim("totals:")}                       ${`${totalMs.toFixed(0)} ms`.padStart(8)}  ${String(totalTokens).padStart(7)}`,
      );
    });
}

function summarize(
  name: string,
  t0: number,
  payload: unknown,
  notes: string[],
): ScenarioResult {
  return {
    name,
    ok: true,
    latency_ms: performance.now() - t0,
    payload_tokens: estimateTokens(JSON.stringify(payload)),
    notes,
  };
}
