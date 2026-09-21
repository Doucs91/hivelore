import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureProjectMcpClients, autoConfigureMcpClients, inspectProjectMcpClients, detectLegacyUserScopeMcpEntries, sweepLegacyUserScopeMcpEntries } from "../src/commands/init-mcp-setup.js";
import { configureCodexMcp, inspectCodexMcp } from "../src/commands/codex-mcp.js";
import { Command } from "commander";
import { detectAgentMode, registerAgent } from "../src/commands/agent.js";

const fake = vi.hoisted(() => ({ servers: [] as any[], calls: [] as string[][], failAdd: false, corrupt: false }));
vi.mock("node:child_process", async (original) => ({
  ...await original<typeof import("node:child_process")>(),
  spawnSync: vi.fn((cmd: string, args: string[]) => {
    if (cmd !== "codex") return { status: 1, stdout: "", stderr: "" };
    fake.calls.push(args);
    const ok = (x: unknown = {}) => ({ status: 0, stdout: JSON.stringify(x), stderr: "" });
    if (args[1] === "list") return fake.corrupt ? { status: 1, stderr: "invalid config" } : ok(fake.servers);
    if (args[1] === "get") { const s = fake.servers.find((s) => s.name === args[2]); return s ? ok(s) : { status: 1 }; }
    if (args[1] === "add") {
      if (fake.failAdd) return { status: 1 };
      fake.servers = fake.servers.filter((s) => s.name !== args[2]);
      fake.servers.push({ name: args[2], enabled: true, transport: { command: args[4], args: args.slice(5) } }); return ok();
    }
    if (args[1] === "remove") { fake.servers = fake.servers.filter((s) => s.name !== args[2]); return ok(); }
    return { status: 1 };
  }),
}));
let dir: string;
let home: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "hivelore-mcp-setup-"));
  home = path.join(dir, "home"); await mkdir(home);
  vi.spyOn(os, "homedir").mockReturnValue(home);
  fake.servers = []; fake.calls = []; fake.failAdd = false; fake.corrupt = false;
});
afterEach(async () => { vi.restoreAllMocks(); await rm(dir, { recursive: true, force: true }); });
async function json(file: string, value: unknown) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value)); }
const dead = () => ({ name: "haive", enabled: true, transport: { command: "haive", args: ["mcp", "--stdio"], env: { HAIVE_PROJECT_ROOT: "/wrong-project" } } });

describe("Codex MCP migration", () => {
  it("replaces the dead command without pinning every project to one root", () => {
    fake.servers = [dead()];
    expect(inspectCodexMcp().status).toBe("stale");
    expect(configureCodexMcp().status).toBe("configured");
    expect(fake.calls).toContainEqual(["mcp", "add", "hivelore", "--", "hivelore", "mcp", "--stdio"]);
    expect(fake.servers).toEqual([{ name: "hivelore", enabled: true, transport: { command: "hivelore", args: ["mcp", "--stdio"] } }]);
    expect(configureCodexMcp().status).toBe("already_configured");
  });
  it("keeps the legacy configuration if registering its replacement fails", () => {
    fake.servers = [dead()]; fake.failAdd = true;
    expect(configureCodexMcp().status).toBe("error");
    expect(fake.calls.some((a) => a[1] === "remove")).toBe(false);
    expect(fake.servers).toEqual([dead()]);
  });
  it("preserves customized current entries while removing only dead legacy entries", () => {
    const custom = { name: "hivelore", enabled: true, transport: { type: "streamable_http", url: "https://custom.example/mcp" } };
    fake.servers = [dead(), custom];
    expect(configureCodexMcp().status).toBe("configured");
    expect(fake.servers).toEqual([custom]);
    expect(fake.calls.some((a) => a[1] === "add")).toBe(false);
  });
  it("does not re-enable servers or overwrite unreadable TOML", () => {
    fake.servers = [{ name: "hivelore", enabled: false, transport: { command: "hivelore" } }];
    expect(configureCodexMcp().status).toBe("error");
    fake.corrupt = true;
    expect(inspectCodexMcp().status).toBe("error");
    expect(configureCodexMcp().status).toBe("error");
    expect(fake.calls.every((a) => a[1] === "list")).toBe(true);
  });
  it("does not reactivate a disabled legacy Codex entry during migration", () => {
    fake.servers = [{ ...dead(), enabled: false }];
    expect(inspectCodexMcp().status).toBe("disabled");
    expect(configureCodexMcp().status).toBe("error");
    expect(fake.calls.every((a) => a[1] === "list")).toBe(true);
  });
  it("repairs dead commands under the current name too", () => {
    fake.servers = [{ ...dead(), name: "hivelore" }];
    expect(configureCodexMcp().status).toBe("configured");
    expect(fake.servers[0].transport.command).toBe("hivelore");
  });
});

describe("MCP client configuration", () => {
  it("preserves unrelated servers and settings during project migration", async () => {
    const file = path.join(dir, ".mcp.json");
    await json(file, { custom: 42, mcpServers: { other: { command: "other" }, hivelore: { command: "haive", timeout: 99, env: { CUSTOM: "keep" } } } });
    expect((await configureProjectMcpClients(dir)).every((r) => r.status === "configured")).toBe(true);
    const got = JSON.parse(await readFile(file, "utf8"));
    expect(got.custom).toBe(42); expect(got.mcpServers.other).toEqual({ command: "other" });
    expect(got.mcpServers.hivelore).toMatchObject({ command: "hivelore", timeout: 99, env: { CUSTOM: "keep", HAIVE_PROJECT_ROOT: dir } });
  });
  it("never overwrites malformed JSON, invalid entries or disabled servers", async () => {
    for (const raw of ['{ bad json', '[]', '{"mcpServers": []}', '{"mcpServers":{"hivelore":{}}}', '{"mcpServers":{"haive":{"command":"haive","disabled":true}}}', '{"mcpServers":{"hivelore":{"command":"hivelore","disabled":true}}}']) {
      const file = path.join(dir, ".mcp.json"); await writeFile(file, raw);
      expect((await configureProjectMcpClients(dir)).find((r) => r.client.startsWith("Claude"))?.status).toBe("error");
      expect(await readFile(file, "utf8")).toBe(raw);
    }
  });
  it("preserves JSONC comments and reports idempotent setup", async () => {
    const file = path.join(dir, ".vscode/mcp.json"); await mkdir(path.dirname(file));
    await writeFile(file, '{\n// keep this explanation\n"servers": {"other": {"command": "other"},},\n}');
    expect((await configureProjectMcpClients(dir)).find((r) => r.client.startsWith("VS Code"))?.status).toBe("configured");
    expect(await readFile(file, "utf8")).toContain("// keep this explanation");
    expect((await configureProjectMcpClients(dir)).find((r) => r.client.startsWith("VS Code"))?.status).toBe("already_configured");
  });
  it("does not erase working custom transports or legacy-named custom servers", async () => {
    const file = path.join(dir, ".mcp.json");
    const servers = { hivelore: { url: "https://custom.example/mcp" }, haive: { command: "my-wrapper" } };
    await json(file, { mcpServers: servers }); await configureProjectMcpClients(dir);
    expect(JSON.parse(await readFile(file, "utf8")).mcpServers).toEqual(servers);
  });
  it("distinguishes file presence from Hivelore configuration and session access", async () => {
    await mkdir(path.join(dir, ".ai"));
    await json(path.join(dir, ".mcp.json"), { mcpServers: { unrelated: { command: "other" } } });
    const configs = await inspectProjectMcpClients(dir);
    expect(configs.find((c) => c.client.startsWith("Claude"))).toMatchObject({ present: true, configured: false, status: "missing" });
    const detection = await detectAgentMode(dir);
    expect(detection.recommended_mode).toBe("fallback");
    expect(detection.session_connection).toBe("unverified");
  });
  it("returns a failing exit status when setup cannot repair a client config", async () => {
    await mkdir(path.join(dir, ".ai")); await writeFile(path.join(dir, ".mcp.json"), "invalid");
    vi.spyOn(console, "log").mockImplementation(() => {});
    const previous = process.exitCode;
    try {
      const program = new Command(); registerAgent(program);
      await program.parseAsync(["node", "hivelore", "agent", "setup", "--no-global", "--json", "--dir", dir]);
      expect(process.exitCode).toBe(1);
    } finally { process.exitCode = previous; }
  });
  it("migrates legacy user entries for VS Code, Claude, Cursor and Windsurf", async () => {
    for (const [relative, key] of [[".config/Code/User/mcp.json", "servers"], [".claude.json", "mcpServers"], [".cursor/mcp.json", "mcpServers"], [".windsurf/mcp.json", "mcpServers"]]) {
      await json(path.join(home, relative!), { [key!]: { haive: { command: "haive-mcp" }, other: { command: "other" } } });
    }
    expect(await detectLegacyUserScopeMcpEntries()).toHaveLength(4);
    expect((await sweepLegacyUserScopeMcpEntries()).every((r) => r.removed.length === 1)).toBe(true);
    expect(await detectLegacyUserScopeMcpEntries()).toHaveLength(0);
  });
  it("sets up detected Gemini and Roo projects and includes Codex in global setup", async () => {
    await mkdir(path.join(home, ".gemini")); await mkdir(path.join(dir, ".roo"));
    const results = await configureProjectMcpClients(dir);
    expect(results.map((r) => r.client)).toContain("Gemini CLI (project)");
    expect(results.map((r) => r.client)).toContain("Roo Code (project)");
    const global = await autoConfigureMcpClients();
    expect(global.find((r) => r.client === "Codex")?.status).toBe("configured");
    expect(global.find((r) => r.client === "Gemini CLI")?.status).toBe("configured");
  });
});
