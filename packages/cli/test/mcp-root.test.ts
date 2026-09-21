import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerMcp } from "../src/commands/mcp.js";
const run = vi.hoisted(() => vi.fn());
vi.mock("@hivelore/mcp", () => ({ runHaiveMcpStdio: run }));
vi.mock("@hivelore/core", () => ({ findProjectRoot: (root?: string) => root ?? "/launch-directory" }));
afterEach(() => { vi.unstubAllEnvs(); run.mockClear(); });
describe("MCP project selection", () => {
  it("uses the configured project even when the client launches elsewhere", async () => {
    vi.stubEnv("HAIVE_PROJECT_ROOT", "/configured project"); vi.stubEnv("HIVELORE_PROJECT_ROOT", undefined);
    const program = new Command(); registerMcp(program);
    await program.parseAsync(["node", "hivelore", "mcp", "--stdio"]);
    expect(run).toHaveBeenCalledWith({ root: "/configured project" });
  });
  it("prefers explicit CLI root, then the current environment name", async () => {
    vi.stubEnv("HAIVE_PROJECT_ROOT", "/legacy"); vi.stubEnv("HIVELORE_PROJECT_ROOT", "/current");
    const program = new Command(); registerMcp(program);
    await program.parseAsync(["node", "hivelore", "mcp"]);
    expect(run).toHaveBeenLastCalledWith({ root: "/current" });
    await program.parseAsync(["node", "hivelore", "mcp", "--dir", "/explicit"]);
    expect(run).toHaveBeenLastCalledWith({ root: "/explicit" });
  });
});
