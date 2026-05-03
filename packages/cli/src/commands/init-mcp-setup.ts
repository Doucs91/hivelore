/**
 * Auto-configure haive-mcp in supported AI clients.
 *
 * Clients supported:
 *   - Cursor  (~/.cursor/mcp.json)
 *   - VS Code (~/.config/Code/User/mcp.json or ~/Library/Application Support/Code/User/mcp.json)
 *   - Claude Code (~/.claude.json mcpServers field)
 *   - Windsurf (~/.codeium/windsurf/mcp_config.json)
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const HOME = os.homedir();
const HAIVE_MCP_ENTRY = {
  command: "haive-mcp",
  args: [] as string[],
};

// ── Cursor ────────────────────────────────────────────────────────────────────

function cursorMcpPath(): string {
  return path.join(HOME, ".cursor", "mcp.json");
}

async function configureCursor(): Promise<ConfigureResult> {
  const mcpPath = cursorMcpPath();
  const cursorDir = path.join(HOME, ".cursor");
  if (!existsSync(cursorDir)) return { client: "Cursor", status: "not_installed" };

  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    try { config = JSON.parse(await readFile(mcpPath, "utf8")); } catch { /* ignore malformed */ }
  }
  config.mcpServers ??= {};
  if (config.mcpServers["haive"]) return { client: "Cursor", status: "already_configured" };

  config.mcpServers["haive"] = HAIVE_MCP_ENTRY;
  await mkdir(cursorDir, { recursive: true });
  await writeFile(mcpPath, JSON.stringify(config, null, 2), "utf8");
  return { client: "Cursor", status: "configured", path: mcpPath };
}

// ── VS Code ───────────────────────────────────────────────────────────────────

function vscodeMcpPath(): string | null {
  const candidates = [
    path.join(HOME, ".config", "Code", "User", "mcp.json"),         // Linux
    path.join(HOME, "Library", "Application Support", "Code", "User", "mcp.json"), // macOS
    path.join(HOME, "AppData", "Roaming", "Code", "User", "mcp.json"),             // Windows
    path.join(HOME, ".config", "Code - Insiders", "User", "mcp.json"),
  ];
  // Return the first one whose *parent directory* exists
  for (const c of candidates) {
    if (existsSync(path.dirname(c))) return c;
  }
  return null;
}

async function configureVSCode(): Promise<ConfigureResult> {
  const mcpPath = vscodeMcpPath();
  if (!mcpPath) return { client: "VS Code", status: "not_installed" };

  let config: { servers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    try { config = JSON.parse(await readFile(mcpPath, "utf8")); } catch { /* ignore */ }
  }
  config.servers ??= {};
  if (config.servers["haive"]) return { client: "VS Code", status: "already_configured" };

  config.servers["haive"] = { ...HAIVE_MCP_ENTRY, type: "stdio" };
  await mkdir(path.dirname(mcpPath), { recursive: true });
  await writeFile(mcpPath, JSON.stringify(config, null, 2), "utf8");
  return { client: "VS Code", status: "configured", path: mcpPath };
}

// ── Claude Code ───────────────────────────────────────────────────────────────

function claudeConfigPath(): string | null {
  const p = path.join(HOME, ".claude.json");
  if (existsSync(p)) return p;
  // Some versions put it here
  const p2 = path.join(HOME, ".config", "claude", "claude.json");
  if (existsSync(path.dirname(p2))) return p2;
  return null;
}

async function configureClaude(): Promise<ConfigureResult> {
  // Claude Code stores MCP servers in ~/.claude.json under mcpServers key
  const cfgPath = claudeConfigPath() ?? path.join(HOME, ".claude.json");
  if (!existsSync(cfgPath) && !existsSync(path.join(HOME, ".claude"))) {
    return { client: "Claude Code", status: "not_installed" };
  }

  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(cfgPath)) {
    try { config = JSON.parse(await readFile(cfgPath, "utf8")); } catch { /* ignore */ }
  }
  config.mcpServers ??= {};
  if (config.mcpServers["haive"]) return { client: "Claude Code", status: "already_configured" };

  config.mcpServers["haive"] = { ...HAIVE_MCP_ENTRY, type: "stdio" };
  await writeFile(cfgPath, JSON.stringify(config, null, 2), "utf8");
  return { client: "Claude Code", status: "configured", path: cfgPath };
}

// ── Windsurf ─────────────────────────────────────────────────────────────────

function windsurfMcpPath(): string | null {
  const candidates = [
    path.join(HOME, ".codeium", "windsurf", "mcp_config.json"),
    path.join(HOME, ".windsurf", "mcp.json"),
  ];
  for (const c of candidates) {
    if (existsSync(path.dirname(c))) return c;
  }
  return null;
}

async function configureWindsurf(): Promise<ConfigureResult> {
  const mcpPath = windsurfMcpPath();
  if (!mcpPath) return { client: "Windsurf", status: "not_installed" };

  let config: { mcpServers?: Record<string, unknown> } = {};
  if (existsSync(mcpPath)) {
    try { config = JSON.parse(await readFile(mcpPath, "utf8")); } catch { /* ignore */ }
  }
  config.mcpServers ??= {};
  if (config.mcpServers["haive"]) return { client: "Windsurf", status: "already_configured" };

  config.mcpServers["haive"] = HAIVE_MCP_ENTRY;
  await mkdir(path.dirname(mcpPath), { recursive: true });
  await writeFile(mcpPath, JSON.stringify(config, null, 2), "utf8");
  return { client: "Windsurf", status: "configured", path: mcpPath };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ConfigureResult {
  client: string;
  status: "configured" | "already_configured" | "not_installed" | "error";
  path?: string;
  error?: string;
}

export async function autoConfigureMcpClients(): Promise<ConfigureResult[]> {
  const results: ConfigureResult[] = [];
  const configurators = [configureCursor, configureVSCode, configureClaude, configureWindsurf];
  for (const fn of configurators) {
    try {
      results.push(await fn());
    } catch (err) {
      const name = fn.name.replace("configure", "");
      results.push({ client: name, status: "error", error: String(err) });
    }
  }
  return results;
}
