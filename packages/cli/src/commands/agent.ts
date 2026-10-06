import { integrationHealth } from "../utils/integration-health.js";
import { repairStaleGitHooks } from "./enforce.js";
import { exerciseHarness } from "../utils/harness-proof.js";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { findProjectRoot, resolveHaivePaths } from "@hivelore/core";
import { autoConfigureMcpClients, configureProjectMcpClients, inspectProjectMcpClients, type McpConfigInspection, type ConfigureResult } from "./init-mcp-setup.js";
import { checkMcpServer } from "../utils/mcp-check.js";
import { inspectCodexMcp } from "./codex-mcp.js";
import { ui } from "../utils/ui.js";

interface AgentOptions {
  dir?: string;
  json?: boolean;
  yes?: boolean;
  global?: boolean;
  noGlobal?: boolean;
  exercise?: boolean;
}

interface AgentDetection {
  root: string;
  initialized: boolean;
  project_mcp: McpConfigInspection[];
  session_connection: "unverified";
  recent_mcp_access?: unknown;
  codex_mcp: ReturnType<typeof inspectCodexMcp>;
  installed_agents: Array<{ agent: string; command: string; installed: boolean; mcp_configured?: boolean }>;
  recommended_mode: "mcp" | "wrapped" | "fallback";
  recommended_command: string;
}

interface AgentModeRecord {
  selected_mode: AgentDetection["recommended_mode"];
  recommended_command: string;
  configured_at: string;
  project_root: string;
  notes: string[];
}

export function registerAgent(program: Command): void {
  const agent = program
    .command("agent")
    .description("Detect, configure, and report the best Hivelore mode for AI coding agents.");

  agent
    .command("detect")
    .description("Detect available AI agents and Hivelore MCP/wrapper readiness.")
    .option("-d, --dir <dir>", "project root")
    .option("--json", "emit JSON", false)
    .action(async (opts: AgentOptions) => {
      const detection = await detectAgentMode(opts.dir);
      printDetection(detection, Boolean(opts.json));
    });

  agent
    .command("status")
    .description("Alias for agent detect.")
    .option("-d, --dir <dir>", "project root")
    .option("--json", "emit JSON", false)
    .action(async (opts: AgentOptions) => {
      const detection = await detectAgentMode(opts.dir);
      printDetection(detection, Boolean(opts.json));
    });

  agent
    .command("check")
    .description("Test MCP initialization and tool discovery (does not prove access inside your AI session).")
    .option("-d, --dir <dir>", "project root")
    .option("--exercise", "exercise context delivery, validated sensor GREEN/RED and hook latency in a disposable repository")
    .option("--json", "emit JSON", false)
    .action(async (opts: AgentOptions) => {
      const root = findProjectRoot(opts.dir);
      const result = await checkMcpServer(root, path.resolve(process.argv[1]!));
      const integration = await integrationHealth(root);
      const exercise = opts.exercise ? await exerciseHarness(path.resolve(process.argv[1]!)) : undefined;
      if (exercise && !exercise.passed) process.exitCode = 1;
      if (opts.json) console.log(JSON.stringify({ ...result, integration, ...(exercise ? { exercise } : {}) }, null, 2));
      else {
        if (result.server_reachable) ui.success(`MCP server ${result.server_version}: ${result.tools.length} tools discovered; briefing exercised=${result.briefing_exercised}.`);
        else ui.error(`MCP handshake failed: ${result.error}`);
        if (exercise) console.log(JSON.stringify(exercise, null, 2));
        for (const name of integration.stale_hooks) ui.warn(`Outdated Git hook: ${name}. Run ${integration.repair_command}.`);
        for (const file of integration.legacy_ci_workflows) ui.warn(`Legacy CI still writes to Git: ${file}. Run ${integration.repair_command} and review its .candidate.`);
        if (integration.restart_required) ui.warn("An older MCP process is alive. Restart the client after updating.");
        ui.info("Session connection remains unverified. Restart your AI client, inspect its MCP list, then call get_briefing.");
      }
      if (!result.server_reachable) process.exitCode = 1;
    });

  agent
    .command("setup")
    .description("Configure Hivelore project MCP, optional global MCP clients, and wrapper fallback metadata.")
    .option("-d, --dir <dir>", "project root")
    .option("-y, --yes", "approve user-level/global MCP configuration without prompting", false)
    .option("--no-global", "skip user-level/global MCP configuration")
    .option("--json", "emit JSON", false)
    .action(async (opts: AgentOptions) => {
      const result = await setupAgentMode(opts.dir, {
        yes: Boolean(opts.yes),
        global: opts.global !== false && opts.noGlobal !== true,
        interactive: process.stdin.isTTY,
      });
      const verification = await checkMcpServer(result.detection.root, path.resolve(process.argv[1]!));
      if (!verification.server_reachable) process.exitCode = 1;
      if ([...result.project_results, ...result.global_results].some((item) => item.status === "error")) process.exitCode = 1;
      if (opts.json) {
        console.log(JSON.stringify({ ...result, verification }, null, 2));
        return;
      }
      printSetupResult(result);
      if (result.repaired_hooks.length) ui.success(`Migrated Git hooks: ${result.repaired_hooks.join(", ")}`);
      for (const candidate of result.ci_candidates) ui.warn(`Review ${candidate} before replacing the legacy workflow.`);
      if (!verification.server_reachable) { ui.error(`Fresh handshake failed: ${verification.error}`); process.exitCode = 1; }
      else ui.success(`Fresh MCP briefing passed (${verification.server_version}); restart existing client sessions.`);
    });
}

export async function setupAgentMode(
  dir: string | undefined,
  opts: { yes?: boolean; global?: boolean; interactive?: boolean } = {},
): Promise<{
  detection: AgentDetection;
  project_results: ConfigureResult[];
  global_results: ConfigureResult[];
  mode_file: string;
  global_skipped_reason?: string;
  repaired_hooks: string[];
  ci_candidates: string[];
}> {
  const root = findProjectRoot(dir);
  const paths = resolveHaivePaths(root);
  const projectResults = await configureProjectMcpClients(root);
  const repairedHooks = await repairStaleGitHooks(root);
  const health = await integrationHealth(root);
  const ciCandidates: string[] = [];
  for (const file of health.legacy_ci_workflows) {
    const { renderCiSyncWorkflow } = await import("./init.js");
    const candidate = `${file}.candidate`;
    // A previously reviewed candidate may contain human edits; never overwrite it.
    if (!existsSync(path.join(root, candidate))) await writeFile(path.join(root, candidate), renderCiSyncWorkflow(), { encoding: "utf8", flag: "wx" });
    ciCandidates.push(candidate);
  }

  let globalResults: ConfigureResult[] = [];
  let globalSkippedReason: string | undefined;
  const shouldConsiderGlobal = opts.global !== false;
  if (shouldConsiderGlobal) {
    const approved = opts.yes === true || (opts.interactive ? await confirmGlobalSetup() : false);
    if (approved) {
      globalResults = await autoConfigureMcpClients();
    } else {
      globalSkippedReason = opts.interactive
        ? "User declined user-level/global MCP configuration."
        : "Non-interactive shell; skipped user-level/global MCP configuration. Re-run `hivelore agent setup --yes` to apply it.";
    }
  } else {
    globalSkippedReason = "User-level/global MCP configuration disabled.";
  }

  const detection = await detectAgentMode(root);
  const modeFile = await writeAgentModeRecord(paths, detection, globalSkippedReason);
  return {
    detection,
    project_results: projectResults,
    repaired_hooks: repairedHooks, ci_candidates: ciCandidates,
    global_results: globalResults,
    mode_file: modeFile,
    ...(globalSkippedReason ? { global_skipped_reason: globalSkippedReason } : {}),
  };
}

export async function detectAgentMode(dir?: string): Promise<AgentDetection> {
  const root = findProjectRoot(dir);
  const paths = resolveHaivePaths(root);
  const projectMcp = await inspectProjectMcpClients(root);
  const codex = inspectCodexMcp();
  const installedAgents = [
    { agent: "Codex", command: "codex", installed: commandExists("codex"), mcp_configured: codex.status === "configured" },
    { agent: "Claude", command: "claude", installed: commandExists("claude") },
    { agent: "Aider", command: "aider", installed: commandExists("aider") },
    { agent: "Cursor", command: "cursor", installed: commandExists("cursor") },
  ];
  const hasProjectMcp = projectMcp.some((item) => item.configured);
  const hasNativeMcp = hasProjectMcp || installedAgents.some((a) => a.mcp_configured);
  const wrapperAgent = installedAgents.find((a) => a.installed && ["codex", "claude", "aider"].includes(a.command));
  const recommendedMode: AgentDetection["recommended_mode"] = hasNativeMcp ? "mcp" : wrapperAgent ? "wrapped" : "fallback";
  const recommendedCommand =
    recommendedMode === "mcp"
      ? "Restart your AI client, then call get_briefing before editing."
      : recommendedMode === "wrapped" && wrapperAgent
        ? `hivelore run -- ${wrapperAgent.command}`
        : 'hivelore briefing --task "..." --files "..."';

  return {
    root,
    initialized: existsSync(paths.haiveDir),
    project_mcp: projectMcp,
    session_connection: "unverified",
    recent_mcp_access: await readFile(path.join(paths.runtimeDir, "enforcement", "mcp-access.json"), "utf8").then(raw => JSON.parse(raw)).catch(() => null),
    codex_mcp: codex,
    installed_agents: installedAgents,
    recommended_mode: recommendedMode,
    recommended_command: recommendedCommand,
  };
}

async function writeAgentModeRecord(
  paths: ReturnType<typeof resolveHaivePaths>,
  detection: AgentDetection,
  skippedReason?: string,
): Promise<string> {
  const dir = path.join(paths.runtimeDir, "enforcement");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "agent-mode.json");
  const record: AgentModeRecord = {
    selected_mode: detection.recommended_mode,
    recommended_command: detection.recommended_command,
    configured_at: new Date().toISOString(),
    project_root: detection.root,
    notes: [
      "mcp = a Hivelore entry is configured; active-session tool availability is unverified.",
      "wrapped = use hivelore run when native MCP is unavailable.",
      "fallback = use hivelore briefing/enforce manually.",
      ...(skippedReason ? [skippedReason] : []),
    ],
  };
  await writeFile(file, JSON.stringify(record, null, 2) + "\n", "utf8");
  return file;
}

async function confirmGlobalSetup(): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      "Configure Hivelore in user-level AI client configs (Cursor/VS Code/Claude/Codex when detected)? [y/N] ",
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

function commandExists(command: string): boolean {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
  });
  return result.status === 0;
}

function printDetection(detection: AgentDetection, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(detection, null, 2));
    return;
  }
  console.log(ui.bold("Hivelore agent status"));
  console.log(ui.dim(`  root: ${detection.root}`));
  console.log(`${detection.initialized ? ui.green("✓") : ui.red("✗")} project initialized`);
  for (const cfg of detection.project_mcp) {
    console.log(`${cfg.configured ? ui.green("✓") : ui.yellow("•")} ${cfg.client} project MCP [${cfg.status}] ${ui.dim(path.relative(detection.root, cfg.path))}`);
  }
  for (const agent of detection.installed_agents) {
    const marker = agent.installed ? ui.green("✓") : ui.dim("•");
    const mcp = agent.mcp_configured === true ? " + Hivelore MCP" : "";
    console.log(`${marker} ${agent.agent} (${agent.command})${mcp}`);
  }
  console.log(`Codex MCP: ${detection.codex_mcp.status}`);
  if (detection.recent_mcp_access) console.log(`Recent MCP access: ${JSON.stringify(detection.recent_mcp_access)}`);
  console.log("Session connection: unverified. Restart the client and call get_briefing to confirm access.");
  console.log(ui.bold(`Recommended mode: ${detection.recommended_mode}`));
  console.log(`  ${detection.recommended_command}`);
}

function printSetupResult(result: Awaited<ReturnType<typeof setupAgentMode>>): void {
  for (const item of result.project_results) {
    if (item.status === "configured") ui.success(`${item.client} project MCP config written (${item.path})`);
    else if (item.status === "already_configured") ui.info(`${item.client} already configured`);
    else if (item.status === "error") ui.warn(`${item.client}: ${item.error}`);
  }
  for (const item of result.global_results) {
    if (item.status === "configured") ui.success(`${item.client} user-level MCP configured${item.path ? ` (${item.path})` : ""}`);
    else if (item.status === "already_configured") ui.info(`${item.client} user-level MCP already configured`);
    else if (item.status === "not_installed") ui.info(`${item.client} not detected`);
    else if (item.status === "error") ui.warn(`${item.client}: ${item.error}`);
  }
  if (result.global_skipped_reason) ui.warn(result.global_skipped_reason);
  ui.success(`Agent mode recorded at ${result.mode_file}`);
  printDetection(result.detection, false);
}
