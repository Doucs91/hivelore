import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { findProjectRoot } from "@hiveai/core";
import { ui } from "../utils/ui.js";

const require = createRequire(import.meta.url);

interface McpOptions {
  dir?: string;
}

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description("Start the hAIve MCP server (stdio transport)")
    .option("-d, --dir <dir>", "project root (defaults to nearest .ai/ or .git/)")
    .action((opts: McpOptions) => {
      const root = findProjectRoot(opts.dir);
      const bin = locateMcpBin();
      if (!bin) {
        ui.error(
          "@hiveai/mcp binary not found. Install @hiveai/mcp or run `pnpm build` in the monorepo.",
        );
        process.exit(1);
      }
      const child = spawn("node", [bin, "--root", root], {
        stdio: ["inherit", "inherit", "inherit"],
        env: process.env,
      });
      child.on("exit", (code) => process.exit(code ?? 0));
    });
}

function locateMcpBin(): string | null {
  // 1. Resolve the @hiveai/mcp package and use its bin entry.
  try {
    const pkgPath = require.resolve("@hiveai/mcp/package.json");
    const pkgDir = path.dirname(pkgPath);
    const candidate = path.join(pkgDir, "dist", "index.js");
    if (existsSync(candidate)) return candidate;
  } catch {
    // not installed — fall through
  }

  // 2. Fallback: look for sibling package in monorepo dev mode.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sibling = path.resolve(here, "..", "..", "..", "mcp", "dist", "index.js");
  if (existsSync(sibling)) return sibling;

  return null;
}
