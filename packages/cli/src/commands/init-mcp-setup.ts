/**
 * Auto-configure haive-mcp in supported AI clients.
 *
 * Two layers:
 *   User-level (global, written once):
 *     - Cursor  (~/.cursor/mcp.json)
 *     - VS Code (~/.config/Code/User/mcp.json or ~/Library/Application Support/Code/User/mcp.json)
 *     - Claude Code (~/.claude.json mcpServers field)
 *     - Windsurf (~/.codeium/windsurf/mcp_config.json)
 *
 *   Project-level (per project, written at haive init, includes HAIVE_PROJECT_ROOT):
 *     - Cursor  (<root>/.cursor/mcp.json)
 *     - VS Code (<root>/.vscode/mcp.json)
 *     - Claude Code (<root>/.mcp.json)
 *
 * Project-level configs take precedence over user-level when the client opens that
 * workspace, ensuring the MCP server always resolves the correct project root even
 * when the same haive-mcp binary serves multiple projects.
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

function projectMcpEntry(root: string) {
  return {
    command: "haive-mcp",
    args: [] as string[],
    env: { HAIVE_PROJECT_ROOT: root },
  };
}

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

/**
 * Write project-level MCP configs that include HAIVE_PROJECT_ROOT so that
 * each AI client uses the correct project root regardless of the server's CWD.
 *
 * These files are machine-specific (absolute paths) and should be gitignored.
 * haive init appends them to .gitignore automatically.
 *
 * Project-level configs take precedence over user-level configs in Cursor and
 * VS Code when the workspace is opened. This is the canonical fix for the
 * "MCP server uses wrong project root in multi-project setups" bug.
 */
export async function configureProjectMcpClients(root: string): Promise<ConfigureResult[]> {
  const entry = projectMcpEntry(root);
  const results: ConfigureResult[] = [];

  // ── Cursor: <root>/.cursor/mcp.json ──────────────────────────────────────
  try {
    const cursorPath = path.join(root, ".cursor", "mcp.json");
    let config: { mcpServers?: Record<string, unknown> } = {};
    if (existsSync(cursorPath)) {
      try { config = JSON.parse(await readFile(cursorPath, "utf8")); } catch { /* keep empty */ }
    }
    config.mcpServers ??= {};
    config.mcpServers["haive"] = entry;
    await mkdir(path.dirname(cursorPath), { recursive: true });
    await writeFile(cursorPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    results.push({ client: "Cursor (project)", status: "configured", path: cursorPath });
  } catch (err) {
    results.push({ client: "Cursor (project)", status: "error", error: String(err) });
  }

  // ── VS Code: <root>/.vscode/mcp.json ─────────────────────────────────────
  try {
    const vscodePath = path.join(root, ".vscode", "mcp.json");
    let config: { servers?: Record<string, unknown> } = {};
    if (existsSync(vscodePath)) {
      try { config = JSON.parse(await readFile(vscodePath, "utf8")); } catch { /* keep empty */ }
    }
    config.servers ??= {};
    config.servers["haive"] = { ...entry, type: "stdio" };
    await mkdir(path.dirname(vscodePath), { recursive: true });
    await writeFile(vscodePath, JSON.stringify(config, null, 2) + "\n", "utf8");
    results.push({ client: "VS Code (workspace)", status: "configured", path: vscodePath });
  } catch (err) {
    results.push({ client: "VS Code (workspace)", status: "error", error: String(err) });
  }

  // ── Claude Code: <root>/.mcp.json ────────────────────────────────────────
  try {
    const mcpPath = path.join(root, ".mcp.json");
    let config: { mcpServers?: Record<string, unknown> } = {};
    if (existsSync(mcpPath)) {
      try { config = JSON.parse(await readFile(mcpPath, "utf8")); } catch { /* keep empty */ }
    }
    config.mcpServers ??= {};
    config.mcpServers["haive"] = { ...entry, type: "stdio" };
    await writeFile(mcpPath, JSON.stringify(config, null, 2) + "\n", "utf8");
    results.push({ client: "Claude Code (project)", status: "configured", path: mcpPath });
  } catch (err) {
    results.push({ client: "Claude Code (project)", status: "error", error: String(err) });
  }

  return results;
}
