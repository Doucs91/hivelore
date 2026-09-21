import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { ConfigureResult } from "./init-mcp-setup.js";

interface CodexServer {
  name: string;
  enabled?: boolean;
  transport?: { command?: string; args?: string[]; type?: string; env?: Record<string, string>; cwd?: string };
}

export interface CodexMcpStatus {
  status: "not_installed" | "missing" | "configured" | "disabled" | "stale" | "error";
  path: string;
  message?: string;
  legacy_names: string[];
}

export function isLegacyMcpCommand(command: unknown): boolean {
  return typeof command === "string" && /(?:^|[\\/])haive(?:-mcp)?(?:\.cmd|\.exe)?$/.test(command.trim());
}

function codex(args: string[]) {
  return spawnSync("codex", args, { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
}

/** Ask Codex to parse its own TOML, including effective project/managed configuration. */
export function inspectCodexMcp(): CodexMcpStatus {
  const configPath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "config.toml");
  const base = { path: configPath, legacy_names: [] as string[] };
  const result = codex(["mcp", "list", "--json"]);
  if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return { ...base, status: "not_installed" };
  if (result.error || result.status !== 0) return { ...base, status: "error", message: "Codex could not read its MCP configuration. Run `codex mcp list` to inspect the error." };
  let servers: CodexServer[];
  try {
    servers = JSON.parse(result.stdout) as CodexServer[];
    if (!Array.isArray(servers) || servers.some((s) => !s || typeof s.name !== "string")) throw new Error();
  } catch {
    return { ...base, status: "error", message: "Codex returned an unsupported MCP configuration format. Update Codex and run `codex mcp list`." };
  }
  const legacyNames = servers.filter((s) => ["haive", "hivelore"].includes(s.name) && isLegacyMcpCommand(s.transport?.command)).map((s) => s.name);
  const current = servers.find((s) => s.name === "hivelore");
  const state = { ...base, legacy_names: legacyNames };
  // Explicit user disabling is not an installation failure; never silently re-enable it.
  const selected = current ?? servers.find((s) => s.name === "haive" && isLegacyMcpCommand(s.transport?.command));
  if (selected?.enabled === false) return { ...state, status: "disabled", message: "Hivelore is disabled in Codex. Enable it in Codex MCP settings if intended." };
  if (legacyNames.length) return { ...state, status: "stale", message: "Codex still references the removed haive executable." };
  if (!current) return { ...state, status: "missing" };
  if (!current.transport || (current.transport.command === "hivelore" && current.transport.args?.[0] !== "mcp")) {
    return { ...state, status: "error", message: "Codex has an invalid Hivelore transport. Configure command hivelore with arguments mcp --stdio in Codex MCP settings." };
  }
  return { ...state, status: "configured" };
}

/** Use the native CLI so comments, other servers, credentials and TOML syntax are preserved. */
export function configureCodexMcp(): ConfigureResult {
  const state = inspectCodexMcp();
  const base = { client: "Codex", path: state.path };
  if (state.status === "not_installed") return { ...base, status: "not_installed" };
  if (state.status === "error" || state.status === "disabled") return { ...base, status: "error", error: state.message };
  if (state.status === "configured") return { ...base, status: "already_configured" };
  // Global config must follow the client's working directory, never pin all projects to this repo.
  // Register the replacement BEFORE removing dead entries, so a failed write cannot lose access.
  if (state.status === "missing" || state.legacy_names.includes("hivelore") || state.legacy_names.includes("haive")) {
    // An existing working hivelore entry must survive cleanup of a separate legacy entry.
    const current = codex(["mcp", "get", "hivelore", "--json"]);
    if (current.status !== 0 || state.legacy_names.includes("hivelore")) {
      const added = codex(["mcp", "add", "hivelore", "--", "hivelore", "mcp", "--stdio"]);
      if (added.error || added.status !== 0) return { ...base, status: "error", error: "Could not register Hivelore. Run `codex mcp add hivelore -- hivelore mcp --stdio`. Existing configuration was not removed." };
    }
  }
  if (state.legacy_names.includes("haive")) {
    const removed = codex(["mcp", "remove", "haive"]);
    if (removed.error || removed.status !== 0) return { ...base, status: "error", error: "Hivelore is registered, but the obsolete entry remains. Run `codex mcp remove haive`." };
  }
  const after = inspectCodexMcp();
  if (after.status !== "configured") return { ...base, status: "error", error: after.message ?? "Codex configuration is still unavailable; check project overrides and managed settings with `codex mcp list`." };
  return { ...base, status: "configured" };
}
