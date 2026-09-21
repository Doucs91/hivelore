/** Client configuration is evidence of setup, never proof of tools in an active session. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse, modify, applyEdits, type ParseError } from "jsonc-parser";
import { configureCodexMcp, isLegacyMcpCommand } from "./codex-mcp.js";

export interface ConfigureResult {
  client: string;
  status: "configured" | "already_configured" | "not_installed" | "error";
  path?: string;
  error?: string;
}
interface ConfigTarget { client: string; file: string; key: "mcpServers" | "servers"; type?: "stdio" }
type JsonObject = Record<string, unknown>;
function object(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function userTargets(): ConfigTarget[] {
  const home = os.homedir();
  return [
    { client: "Gemini CLI", file: path.join(home, ".gemini/settings.json"), key: "mcpServers" },
    { client: "Cursor", file: path.join(home, ".cursor/mcp.json"), key: "mcpServers" },
    ...[".config/Code/User", "Library/Application Support/Code/User", "AppData/Roaming/Code/User", ".config/Code - Insiders/User"].map((dir): ConfigTarget => ({
      client: "VS Code", file: path.join(home, dir, "mcp.json"), key: "servers", type: "stdio",
    })),
    { client: "Claude Code", file: path.join(home, ".claude.json"), key: "mcpServers", type: "stdio" },
    { client: "Claude Code", file: path.join(home, ".config/claude/claude.json"), key: "mcpServers", type: "stdio" },
    { client: "Windsurf", file: path.join(home, ".codeium/windsurf/mcp_config.json"), key: "mcpServers" },
    { client: "Windsurf", file: path.join(home, ".windsurf/mcp.json"), key: "mcpServers" },
  ];
}
function projectTargets(root: string): ConfigTarget[] {
  return [
    { client: "Cursor (project)", file: path.join(root, ".cursor/mcp.json"), key: "mcpServers" },
    { client: "VS Code (workspace)", file: path.join(root, ".vscode/mcp.json"), key: "servers", type: "stdio" },
    { client: "Claude Code (project)", file: path.join(root, ".mcp.json"), key: "mcpServers", type: "stdio" },
    ...(existsSync(path.join(root, ".gemini")) || existsSync(path.join(os.homedir(), ".gemini"))
      ? [{ client: "Gemini CLI (project)", file: path.join(root, ".gemini/settings.json"), key: "mcpServers" as const }] : []),
    ...(existsSync(path.join(root, ".roo"))
      ? [{ client: "Roo Code (project)", file: path.join(root, ".roo/mcp.json"), key: "mcpServers" as const }] : []),
  ];
}
function installed(target: ConfigTarget): boolean {
  if (existsSync(target.file)) return true;
  if (target.file === path.join(os.homedir(), ".claude.json")) return existsSync(path.join(os.homedir(), ".claude"));
  return existsSync(path.dirname(target.file));
}

/** Never replace a malformed config with an empty object: it may contain unrelated servers. */
async function readConfig(target: ConfigTarget): Promise<{ raw: string; config: JsonObject; servers: JsonObject }> {
  const raw = existsSync(target.file) ? await readFile(target.file, "utf8") : "{}\n";
  const errors: ParseError[] = [];
  const config: unknown = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length) throw new Error(`Invalid JSON/JSONC in ${target.file}; file left unchanged.`);
  if (!object(config)) throw new Error(`Invalid object in ${target.file}; file left unchanged.`);
  const servers = config[target.key] ?? {};
  if (!object(servers)) throw new Error(`Invalid ${target.key} in ${target.file}; file left unchanged.`);
  return { raw, config, servers };
}

async function configureJson(target: ConfigTarget, root?: string): Promise<ConfigureResult> {
  const base = { client: target.client, path: target.file };
  try {
    const { raw, servers } = await readConfig(target);
    const current = servers.hivelore;
    if (current === undefined && object(servers.haive) && isLegacyMcpCommand(servers.haive.command)
      && (servers.haive.disabled === true || servers.haive.enabled === false)) {
      throw new Error("The legacy Hivelore entry is explicitly disabled. Enable it in client MCP settings if intended; file left unchanged.");
    }
    if (current !== undefined && !object(current)) throw new Error("Invalid Hivelore entry; fix it in the client MCP settings. File left unchanged.");
    if (object(current) && (current.disabled === true || current.enabled === false)) {
      throw new Error("Hivelore is explicitly disabled. Enable it in the client MCP settings if intended; file left unchanged.");
    }
    if (object(current) && !(typeof current.command === "string" && current.command.trim()) && !(typeof current.url === "string" && current.url.trim())) {
      throw new Error("Hivelore has neither a command nor a URL; file left unchanged. Repair the entry in the client MCP settings.");
    }
    if (object(current) && current.command === "hivelore" && (!Array.isArray(current.args) || current.args[0] !== "mcp")) {
      throw new Error("Hivelore needs arguments mcp --stdio. Correct the entry in client MCP settings; file left unchanged.");
    }
    const legacy = object(servers.haive) && isLegacyMcpCommand(servers.haive.command);
    const stale = object(current) && isLegacyMcpCommand(current.command);
    if (current && !stale && !root && !legacy) return { ...base, status: "already_configured" };
    // Preserve customized working transports and all client-specific options.
    // Refresh the project root only on entries we recognize as the bundled server.
    const bundled = object(current) && current.command === "hivelore" && Array.isArray(current.args) && current.args[0] === "mcp";
    if (!current || stale || (root && bundled)) {
      const env = object(current) && object(current.env) ? current.env : {};
      servers.hivelore = {
        ...(object(current) ? current : {}),
        command: "hivelore", args: ["mcp", "--stdio", ...(root ? ["--dir", root] : [])],
        ...(target.type ? { type: target.type } : {}),
        ...(root ? { env: { ...env, HAIVE_PROJECT_ROOT: root, HIVELORE_PROJECT_ROOT: root } } : {}),
      };
    }
    const options = { formattingOptions: { insertSpaces: true, tabSize: 2 } };
    let updated = raw;
    if (JSON.stringify(current) !== JSON.stringify(servers.hivelore)) {
      updated = applyEdits(updated, modify(updated, [target.key, "hivelore"], servers.hivelore, options));
    }
    if (legacy) updated = applyEdits(updated, modify(updated, [target.key, "haive"], undefined, options));
    if (updated === raw) return { ...base, status: "already_configured" };
    await mkdir(path.dirname(target.file), { recursive: true });
    await writeFile(target.file, updated, "utf8");
    return { ...base, status: "configured" };
  } catch (error) {
    return { ...base, status: "error", error: `Could not configure ${target.file}: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function autoConfigureMcpClients(): Promise<ConfigureResult[]> {
  const results: ConfigureResult[] = [];
  for (const target of userTargets()) {
    if (installed(target)) results.push(await configureJson(target));
  }
  results.push(configureCodexMcp());
  return results;
}
export async function configureProjectMcpClients(root: string): Promise<ConfigureResult[]> {
  const results: ConfigureResult[] = [];
  for (const target of projectTargets(root)) results.push(await configureJson(target, root));
  // Generated configurations carry machine-specific roots. Keep newly generated files local.
  if (existsSync(path.join(root, ".git"))) {
    const ignorePath = path.join(root, ".gitignore");
    const existing = existsSync(ignorePath) ? await readFile(ignorePath, "utf8") : "";
    const lines = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
    const missing = results.filter((r) => r.status !== "error" && r.path)
      .map((r) => path.relative(root, r.path!).split(path.sep).join("/"))
      .filter((file) => !lines.has(file) && !lines.has(`/${file}`));
    if (missing.length) await writeFile(ignorePath, existing + (existing.endsWith("\n") || !existing ? "" : "\n") + missing.join("\n") + "\n", "utf8");
  }
  return results;
}

export interface McpConfigInspection {
  client: string;
  path: string;
  present: boolean;
  configured: boolean;
  status: "missing" | "configured" | "stale" | "disabled" | "invalid";
}
export async function inspectProjectMcpClients(root: string): Promise<McpConfigInspection[]> {
  return inspectTargets(projectTargets(root));
}
export async function inspectUserMcpClients(): Promise<McpConfigInspection[]> {
  return inspectTargets(userTargets().filter(installed));
}
async function inspectTargets(targets: ConfigTarget[]): Promise<McpConfigInspection[]> {
  return Promise.all(targets.map(async (target) => {
    const base = { client: target.client, path: target.file, present: existsSync(target.file), configured: false };
    try {
      const { servers } = await readConfig(target);
      const entry = servers.hivelore ?? servers.haive;
      if (!entry) return { ...base, status: "missing" as const };
      if (!object(entry)) return { ...base, status: "invalid" as const };
      if (entry.disabled === true || entry.enabled === false) return { ...base, status: "disabled" as const };
      if (isLegacyMcpCommand(entry.command)) return { ...base, status: "stale" as const };
      if (entry.command === "hivelore" && (!Array.isArray(entry.args) || entry.args[0] !== "mcp")) return { ...base, status: "invalid" as const };
      const validTransport = (typeof entry.command === "string" && entry.command.length > 0) || (typeof entry.url === "string" && entry.url.length > 0);
      return { ...base, configured: validTransport, status: validTransport ? "configured" as const : "invalid" as const };
    } catch { return { ...base, status: "invalid" as const }; }
  }));
}

export interface LegacyMcpSweepResult { client: string; path: string; removed: string[]; error?: string }
export async function detectLegacyUserScopeMcpEntries(): Promise<LegacyMcpSweepResult[]> {
  const results: LegacyMcpSweepResult[] = [];
  for (const target of userTargets().filter(installed)) {
    try {
      const { servers } = await readConfig(target);
      const removed = ["haive", "hivelore"].filter((name) => object(servers[name]) && isLegacyMcpCommand(servers[name].command));
      if (removed.length) results.push({ client: target.client, path: target.file, removed });
    } catch { /* Report invalid configs through inspectUserMcpClients, never delete them. */ }
  }
  return results;
}
export async function sweepLegacyUserScopeMcpEntries(): Promise<LegacyMcpSweepResult[]> {
  const results: LegacyMcpSweepResult[] = [];
  for (const entry of await detectLegacyUserScopeMcpEntries()) {
    const target = userTargets().find((t) => t.file === entry.path)!;
    const result = await configureJson(target);
    results.push({ ...entry, removed: result.status === "error" ? [] : entry.removed, ...(result.error ? { error: result.error } : {}) });
  }
  return results;
}

/** Migrate only the Hivelore entries in a project file; do not rewrite other servers' args. */
export async function repairLegacyProjectMcpFile(file: string): Promise<ConfigureResult> {
  const parent = path.dirname(file);
  const nested = [".cursor", ".vscode", ".roo", ".gemini"].includes(path.basename(parent));
  return configureJson({ client: "Project MCP", file,
    key: path.basename(parent) === ".vscode" ? "servers" : "mcpServers" }, nested ? path.dirname(parent) : parent);
}
