#!/usr/bin/env node
/**
 * Agent ROI benchmark — compares a *proxy* "without hAIve" exploration cost vs
 * "with hAIve" (get_briefing compact [+ optional code_map]) on the same repo/task.
 *
 * Protocol:
 * - WITHOUT hAIve: curated sequential file reads + per-read tool overhead (heuristic).
 * - WITH hAIve: get_briefing(compact, budgeted) [+ code_map budgeted] + MCP overhead per call.
 *
 *   pnpm build && node scripts/agent-roi-benchmark.mjs > benchmark-results/latest.stdout.json
 *
 * Writes benchmark-results/roi-proxy-YYYY-MM-DD.json (pretty JSON).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

const CHARS_PER_TOKEN = 4;
function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

const TOOL_OVERHEAD_PER_FILE_READ = 185;
const MCP_TOOL_OVERHEAD = 440;

async function loadBuiltModules() {
  const coreUrl = pathToFileURL(path.join(REPO_ROOT, "packages/core/dist/index.js")).href;
  const mcpUrl = pathToFileURL(path.join(REPO_ROOT, "packages/mcp/dist/server.js")).href;
  const core = await import(coreUrl);
  const mcp = await import(mcpUrl);
  return { core, mcp };
}

function readFileCapped(relFromRoot, root, maxChars = 80_000) {
  const full = path.join(root, relFromRoot);
  if (!existsSync(full)) return null;
  let s = readFileSync(full, "utf8");
  const truncated = s.length > maxChars;
  if (truncated) s = s.slice(0, maxChars);
  return { rel: relFromRoot, text: s, truncated };
}

function naiveArm(label, root, relativePaths, options = {}) {
  const maxChars = options.maxCharsPerFile ?? 80_000;
  const chunks = [];
  let filesRead = 0;
  let missing = 0;
  const t0 = performance.now();
  for (const rel of relativePaths) {
    const hit = readFileCapped(rel, root, maxChars);
    if (!hit) {
      missing++;
      continue;
    }
    filesRead++;
    chunks.push(`--- ${hit.rel}${hit.truncated ? " [truncated]" : ""} ---\n${hit.text}`);
  }
  const latency_ms = Math.round(performance.now() - t0 + filesRead * 35);
  const narrative = chunks.join("\n\n");
  const contentTokens = estimateTokens(narrative);
  const toolTax = filesRead * TOOL_OVERHEAD_PER_FILE_READ;
  const totalTokens = contentTokens + toolTax;
  return {
    arm: label,
    files_read: filesRead,
    missing_paths: missing,
    content_tokens: contentTokens,
    tool_overhead_tokens: toolTax,
    total_tokens_proxy: totalTokens,
    latency_ms,
  };
}

async function haiveArm(ctx, task, getBriefing, codeMapTool, includeCodeMap) {
  const t0 = performance.now();
  const briefing = await getBriefing(
    {
      task,
      files: [],
      max_tokens: 8000,
      max_memories: 10,
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
  const t1 = performance.now();
  let codeMapPayload = null;
  let t2 = t1;
  if (includeCodeMap) {
    codeMapPayload = await codeMapTool({ paths: [], max_files: 50, max_tokens: 2500 }, ctx);
    t2 = performance.now();
  }
  const briefingTokens = estimateTokens(JSON.stringify(briefing));
  const mapTokens = includeCodeMap ? estimateTokens(JSON.stringify(codeMapPayload)) : 0;
  const totalTokens =
    MCP_TOOL_OVERHEAD +
    briefingTokens +
    (includeCodeMap ? MCP_TOOL_OVERHEAD + mapTokens : 0);

  return {
    arm: "with_haive",
    tool_calls_proxy: 1 + (includeCodeMap ? 1 : 0),
    get_briefing_latency_ms: Math.round(t1 - t0),
    code_map_latency_ms: includeCodeMap ? Math.round(t2 - t1) : 0,
    latency_ms: Math.round(t2 - t0),
    briefing_payload_tokens: briefingTokens,
    briefing_estimated_tokens_field: briefing.estimated_tokens ?? null,
    memories_returned: briefing.memories?.length ?? 0,
    search_mode: briefing.search_mode,
    low_value: !!briefing.low_value,
    code_map_included: includeCodeMap,
    total_tokens_proxy: totalTokens,
  };
}

function scenarioMatrix() {
  return [
    {
      id: "haive-monorepo-mcp",
      project_label: "large_ts_monorepo",
      root: REPO_ROOT,
      task: "Where are MCP tools registered and how do I add a new tool?",
      naive_paths: [
        ".ai/project-context.md",
        "README.md",
        "package.json",
        "packages/mcp/package.json",
        "packages/mcp/src/server.ts",
        "packages/cli/src/index.ts",
        "packages/cli/package.json",
        ".cursorrules",
      ],
    },
    {
      id: "haive-monorepo-tokens",
      project_label: "large_ts_monorepo",
      root: REPO_ROOT,
      task: "How does get_briefing allocate token budget across project context and memories?",
      naive_paths: [
        ".ai/project-context.md",
        "packages/core/src/token-budget.ts",
        "packages/mcp/src/tools/get-briefing.ts",
        "CHANGELOG.md",
      ],
    },
    {
      id: "haive-monorepo-sync",
      project_label: "large_ts_monorepo",
      root: REPO_ROOT,
      task: "What does haive sync do after a git merge?",
      naive_paths: [".ai/project-context.md", "packages/cli/src/commands/sync.ts", "packages/core/src/verifier.ts"],
    },
  ];
}

async function ensureTinyFixture() {
  const dir = path.join(tmpdir(), `haive-roi-mini-${process.pid}`);
  await mkdir(path.join(dir, ".ai/memories/team"), { recursive: true });
  await mkdir(path.join(dir, ".ai/memories/personal"), { recursive: true });
  await mkdir(path.join(dir, ".ai/memories/module"), { recursive: true });
  await mkdir(path.join(dir, "src"), { recursive: true });
  writeFileSync(
    path.join(dir, ".ai/project-context.md"),
    "# Tiny service\n\nSingle-purpose demo package for benchmarks.\n",
  );
  writeFileSync(
    path.join(dir, ".ai/memories/team/2026-05-04-convention-main-entry-src-index.md"),
    `---
id: 2026-05-04-convention-main-entry-src-index
scope: team
type: convention
status: validated
tags: [entrypoint]
---

# Public API lives in src/index.ts

Export \`createServer()\` from \`src/index.ts\`. Do not add logic to package.json hooks.
`,
  );
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "tiny-bench", version: "1.0.0", type: "module" }, null, 2),
  );
  writeFileSync(path.join(dir, "README.md"), "# tiny-bench\n\nSee src/index.ts.\n");
  writeFileSync(
    path.join(dir, "src/index.ts"),
    `/** Application entry — convention memory points here */\nexport function createServer(): string {\n  return "ok";\n}\n`,
  );
  return dir;
}

async function main() {
  const { core, mcp } = await loadBuiltModules();
  const { resolveHaivePaths } = core;
  const { getBriefing, codeMapTool } = mcp;

  const tinyRoot = await ensureTinyFixture();
  const scenarios = [
    ...scenarioMatrix(),
    {
      id: "tiny-lib-entrypoint",
      project_label: "small_ts_library",
      root: tinyRoot,
      task: "Where should I add a new exported function for the public API?",
      naive_paths: ["README.md", "package.json", "src/index.ts", ".ai/project-context.md"],
    },
  ];

  const results = [];
  const startedAt = new Date().toISOString();

  for (const sc of scenarios) {
    const ctx = { paths: resolveHaivePaths(sc.root) };
    const naive = naiveArm("without_haive_naive_reads", sc.root, sc.naive_paths);
    const withBriefingOnly = await haiveArm(ctx, sc.task, getBriefing, codeMapTool, false);
    const withBriefingAndMap = await haiveArm(ctx, sc.task, getBriefing, codeMapTool, true);

    const savingsBrief =
      naive.total_tokens_proxy > 0
        ? (100 * (naive.total_tokens_proxy - withBriefingOnly.total_tokens_proxy)) / naive.total_tokens_proxy
        : 0;
    const savingsMap =
      naive.total_tokens_proxy > 0
        ? (100 * (naive.total_tokens_proxy - withBriefingAndMap.total_tokens_proxy)) / naive.total_tokens_proxy
        : 0;

    results.push({
      scenario_id: sc.id,
      project_label: sc.project_label,
      task: sc.task,
      naive_exploration: naive,
      with_haive_get_briefing: withBriefingOnly,
      with_haive_briefing_plus_code_map: withBriefingAndMap,
      token_savings_pct_vs_naive: {
        briefing_only: Number(savingsBrief.toFixed(1)),
        briefing_plus_code_map: Number(savingsMap.toFixed(1)),
      },
    });
  }

  await rm(tinyRoot, { recursive: true, force: true }).catch(() => {});

  let sumNaive = 0;
  let sumBrief = 0;
  let sumBriefMap = 0;
  let sumFiles = 0;
  let sumBriefCalls = 0;
  let sumBriefMapCalls = 0;
  for (const r of results) {
    sumNaive += r.naive_exploration.total_tokens_proxy;
    sumBrief += r.with_haive_get_briefing.total_tokens_proxy;
    sumBriefMap += r.with_haive_briefing_plus_code_map.total_tokens_proxy;
    sumFiles += r.naive_exploration.files_read;
    sumBriefCalls += r.with_haive_get_briefing.tool_calls_proxy;
    sumBriefMapCalls += r.with_haive_briefing_plus_code_map.tool_calls_proxy;
  }

  const report = {
    protocol_version: 1,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    assumptions: {
      chars_per_token: CHARS_PER_TOKEN,
      tool_overhead_per_file_read_tokens: TOOL_OVERHEAD_PER_FILE_READ,
      mcp_tool_overhead_tokens: MCP_TOOL_OVERHEAD,
      naive_paths_are_curated_not_exhaustive:
        "Curated first-pass reads before locating edit sites — not worst-case exhaustive search.",
    },
    note_real_agents:
      "Live LLM variance is high; combine this proxy with logged multi-agent runs — see team memory 2026-04-28-decision-benchmark-results-v027-token-reduction.md.",
    scenarios: results,
    aggregate_across_scenarios: {
      scenarios_count: results.length,
      sum_naive_proxy_tokens: sumNaive,
      sum_with_haive_briefing_only_tokens: sumBrief,
      sum_with_haive_briefing_plus_code_map_tokens: sumBriefMap,
      pct_tokens_saved_briefing_vs_naive: Number((((sumNaive - sumBrief) / sumNaive) * 100).toFixed(1)),
      pct_tokens_saved_briefing_map_vs_naive: Number((((sumNaive - sumBriefMap) / sumNaive) * 100).toFixed(1)),
      sum_naive_file_reads: sumFiles,
      equivalent_tool_calls_haive_briefing_only: sumBriefCalls,
      equivalent_tool_calls_haive_with_code_map: sumBriefMapCalls,
    },
  };

  const outDir = path.join(REPO_ROOT, "benchmark-results");
  mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `roi-proxy-${startedAt.slice(0, 10)}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.error("\nWritten:", outFile);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
