import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import { findProjectRoot, resolveHaivePaths } from "@hiveai/core";
import { autoConfigureMcpClients, configureProjectMcpClients, type ConfigureResult } from "./init-mcp-setup.js";
import { ui } from "../utils/ui.js";

interface AgentOptions {
  dir?: string;
  json?: boolean;
  yes?: boolean;
  global?: boolean;
  noGlobal?: boolean;
}

interface AgentDetection {
  root: string;
  initialized: boolean;
  project_mcp: Array<{ client: string; path: string; present: boolean }>;
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
    .description("Detect, configure, and report the best hAIve mode for AI coding agents.");

  agent
    .command("detect")
    .description("Detect available AI agents and hAIve MCP/wrapper readiness.")
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
    .command("setup")
    .description("Configure hAIve project MCP, optional global MCP clients, and wrapper fallback metadata.")
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
      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      printSetupResult(result);
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
}> {
  const root = findProjectRoot(dir);
  const paths = resolveHaivePaths(root);
  const projectResults = await configureProjectMcpClients(root);
  const detectionBeforeGlobal = await detectAgentMode(root);

  let globalResults: ConfigureResult[] = [];
  let globalSkippedReason: string | undefined;
  const shouldConsiderGlobal = opts.global !== false;
  if (shouldConsiderGlobal) {
    const approved = opts.yes === true || (opts.interactive ? await confirmGlobalSetup() : false);
    if (approved) {
      globalResults = await autoConfigureMcpClients();
      const codex = await configureCodexIfAvailable(root);
      if (codex) globalResults.push(codex);
    } else {
      globalSkippedReason = opts.interactive
        ? "User declined user-level/global MCP configuration."
        : "Non-interactive shell; skipped user-level/global MCP configuration. Re-run `haive agent setup --yes` to apply it.";
    }
  } else {
    globalSkippedReason = "User-level/global MCP configuration disabled.";
  }

  const detection = await detectAgentMode(root);
  const modeFile = await writeAgentModeRecord(paths, detection, globalSkippedReason);
  return {
    detection,
    project_results: projectResults,
    global_results: globalResults,
    mode_file: modeFile,
    ...(globalSkippedReason ? { global_skipped_reason: globalSkippedReason } : {}),
  };
}

export async function detectAgentMode(dir?: string): Promise<AgentDetection> {
  const root = findProjectRoot(dir);
  const paths = resolveHaivePaths(root);
  const projectMcp = [
    { client: "Claude Code", path: path.join(root, ".mcp.json"), present: existsSync(path.join(root, ".mcp.json")) },
    { client: "Cursor", path: path.join(root, ".cursor", "mcp.json"), present: existsSync(path.join(root, ".cursor", "mcp.json")) },
    { client: "VS Code", path: path.join(root, ".vscode", "mcp.json"), present: existsSync(path.join(root, ".vscode", "mcp.json")) },
  ];
  const installedAgents = [
    { agent: "Codex", command: "codex", installed: commandExists("codex"), mcp_configured: codexMcpConfigured() },
    { agent: "Claude", command: "claude", installed: commandExists("claude") },
    { agent: "Aider", command: "aider", installed: commandExists("aider") },
    { agent: "Cursor", command: "cursor", installed: commandExists("cursor") },
  ];
  const hasProjectMcp = projectMcp.some((item) => item.present);
  const hasNativeMcp = hasProjectMcp || installedAgents.some((a) => a.mcp_configured);
  const wrapperAgent = installedAgents.find((a) => a.installed && ["codex", "claude", "aider"].includes(a.command));
  const recommendedMode: AgentDetection["recommended_mode"] = hasNativeMcp ? "mcp" : wrapperAgent ? "wrapped" : "fallback";
  const recommendedCommand =
    recommendedMode === "mcp"
      ? "Restart your AI client, then call get_briefing before editing."
      : recommendedMode === "wrapped" && wrapperAgent
        ? `haive run -- ${wrapperAgent.command}`
        : 'haive briefing --task "..." --files "..."';

  return {
    root,
    initialized: existsSync(paths.haiveDir),
    project_mcp: projectMcp,
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
      "mcp = native hAIve MCP tools are available or project MCP config exists.",
      "wrapped = use haive run when native MCP is unavailable.",
      "fallback = use haive briefing/enforce manually.",
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
      "Configure hAIve in user-level AI client configs (Cursor/VS Code/Claude/Codex when detected)? [y/N] ",
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

async function configureCodexIfAvailable(root: string): Promise<ConfigureResult | null> {
  if (!commandExists("codex")) return { client: "Codex", status: "not_installed" };
  if (codexMcpConfigured()) return { client: "Codex", status: "already_configured" };
  const result = spawnSync("codex", [
    "mcp",
    "add",
    "haive",
    "--env",
    `HAIVE_PROJECT_ROOT=${root}`,
    "--",
    "haive",
    "mcp",
    "--stdio",
  ], { encoding: "utf8" });
  if (result.status === 0) return { client: "Codex", status: "configured", path: path.join(os.homedir(), ".codex", "config.toml") };
  return { client: "Codex", status: "error", error: result.stderr || result.stdout || "codex mcp add failed" };
}

function commandExists(command: string): boolean {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0;
}

function codexMcpConfigured(): boolean {
  if (!commandExists("codex")) return false;
  const result = spawnSync("codex", ["mcp", "get", "haive"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0;
}

function printDetection(detection: AgentDetection, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(detection, null, 2));
    return;
  }
  console.log(ui.bold("hAIve agent status"));
  console.log(ui.dim(`  root: ${detection.root}`));
  console.log(`${detection.initialized ? ui.green("✓") : ui.red("✗")} project initialized`);
  for (const cfg of detection.project_mcp) {
    console.log(`${cfg.present ? ui.green("✓") : ui.yellow("•")} ${cfg.client} project MCP ${ui.dim(path.relative(detection.root, cfg.path))}`);
  }
  for (const agent of detection.installed_agents) {
    const marker = agent.installed ? ui.green("✓") : ui.dim("•");
    const mcp = agent.mcp_configured === true ? " + hAIve MCP" : "";
    console.log(`${marker} ${agent.agent} (${agent.command})${mcp}`);
  }
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
