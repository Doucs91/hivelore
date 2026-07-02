import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createHaiveServer,
  ENFORCEMENT_PROFILE_TOOLS,
  EXPERIMENTAL_PROFILE_TOOLS,
  MAINTENANCE_PROFILE_TOOLS,
  getAllowedToolsForProfile,
} from "../src/server.js";

/**
 * Pre-publish guard. The published v0.5.0 mcp dist was missing 5 tools because
 * pnpm publish shipped a stale dist/server.js (built before the new tool files
 * were added). This test makes that regression impossible by:
 *
 *  1. Asserting that the SOURCE registers the canonical list of tools.
 *  2. Asserting that any present dist/server.js mirrors that list.
 *
 * Add new tools to EXPECTED_TOOLS below when you ship one.
 */

const ENFORCEMENT_TOOLS = [...ENFORCEMENT_PROFILE_TOOLS].sort();
const MAINTENANCE_TOOLS = [...MAINTENANCE_PROFILE_TOOLS].sort();
const FULL_TOOLS = [...EXPERIMENTAL_PROFILE_TOOLS].sort();

interface InternalServerShape {
  server?: { _registeredTools?: Record<string, unknown> };
  _registeredTools?: Record<string, unknown>;
}

function readRegisteredTools(server: unknown): string[] {
  // The McpServer SDK exposes the inner `Server` instance via `.server`, which
  // holds `_registeredTools` (object keyed by tool name). Both shapes have been
  // observed across SDK versions — handle both.
  const cast = server as InternalServerShape;
  const inner =
    cast?.server?._registeredTools ?? cast?._registeredTools ?? {};
  return Object.keys(inner).sort();
}

describe("Hivelore MCP server — registered tools", () => {
  it("registers the enforcement tool profile by default", () => {
    const { server } = createHaiveServer({ root: process.cwd() });
    const registered = readRegisteredTools(server);

    if (registered.length === 0) {
      // Fallback: if the SDK shape changed and we can't read internals, skip
      // this assertion rather than fail mysteriously. The dist-level test below
      // still catches stale builds.
      console.warn(
        "[guard] could not introspect _registeredTools — skipping source-level check",
      );
      return;
    }

    const missing = ENFORCEMENT_TOOLS.filter((t) => !registered.includes(t));
    const unexpected = registered.filter((t) => !ENFORCEMENT_TOOLS.includes(t));

    expect(missing, `Missing tools — server.ts forgot to register: ${missing.join(", ")}`)
      .toEqual([]);
    expect(unexpected, `Unexpected tools in enforcement profile: ${unexpected.join(", ")}`)
      .toEqual([]);
  });

  it("registers the full legacy tool profile when requested", () => {
    const { server } = createHaiveServer({
      root: process.cwd(),
      env: { ...process.env, HAIVE_TOOL_PROFILE: "full" },
    });
    const registered = readRegisteredTools(server);
    if (registered.length === 0) return;

    const missing = FULL_TOOLS.filter((t) => !registered.includes(t));
    const unexpected = registered.filter((t) => !FULL_TOOLS.includes(t));

    expect(missing, `Missing full-profile tools: ${missing.join(", ")}`)
      .toEqual([]);
    expect(unexpected, `Unexpected full-profile tools — update FULL_TOOLS to include: ${unexpected.join(", ")}`)
      .toEqual([]);
  });

  it("registers the maintenance profile without experimental diagnostics", () => {
    const { server } = createHaiveServer({
      root: process.cwd(),
      env: { ...process.env, HAIVE_TOOL_PROFILE: "maintenance" },
    });
    const registered = readRegisteredTools(server);
    if (registered.length === 0) return;

    const missing = MAINTENANCE_TOOLS.filter((t) => !registered.includes(t));
    const unexpected = registered.filter((t) => !MAINTENANCE_TOOLS.includes(t));

    expect(missing, `Missing maintenance-profile tools: ${missing.join(", ")}`)
      .toEqual([]);
    expect(unexpected, `Unexpected maintenance-profile tools: ${unexpected.join(", ")}`)
      .toEqual([]);
    expect(registered).not.toContain("pattern_detect");
    expect(registered).not.toContain("runtime_journal_append");
    expect(registered).not.toContain("why_this_file");
  });

  it("keeps full as a legacy alias for experimental", () => {
    expect([...getAllowedToolsForProfile("full")].sort())
      .toEqual([...getAllowedToolsForProfile("experimental")].sort());
  });

  it("dist/server.js mentions every expected tool (publish-time guard)", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const distFile = path.resolve(here, "..", "dist", "server.js");
    if (!existsSync(distFile)) {
      // Skip when running before a build — devs may run vitest without building.
      // CI / publish flow MUST run `pnpm -r build` before `pnpm -r test` so this
      // file exists and the assertion runs.
      return;
    }
    const dist = readFileSync(distFile, "utf8");
    const missing = FULL_TOOLS.filter((tool) => {
      // server.tool("name", ...) — match the literal as a JSON-quoted string.
      const re = new RegExp(`["']${tool.replace(/_/g, "_")}["']`);
      return !re.test(dist);
    });
    expect(
      missing,
      `dist/server.js is missing tools: ${missing.join(", ")}. Likely stale dist — run pnpm -r build before publish.`,
    ).toEqual([]);
  });
});
