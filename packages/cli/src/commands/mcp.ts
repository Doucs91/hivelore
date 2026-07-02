import { Command } from "commander";
import { findProjectRoot } from "@hivelore/core";
import { runHaiveMcpStdio } from "@hivelore/mcp";
import { ui } from "../utils/ui.js";

interface McpOptions {
  dir?: string;
  root?: string;
  /** Recognized so JSON configs may pass `[\"mcp\", \"--stdio\"]` — MCP always uses stdio. */
  stdio?: boolean;
}

export function registerMcp(program: Command): void {
  program
    .command("mcp")
    .description(
      "Run the Hivelore MCP server over stdio (bundled — same tools as legacy haive-mcp).\n\n" +
      "  Configure via hivelore init (project-level), or manually:\n" +
      '    \"command\": \"hivelore\",\n' +
      '    \"args\": [\"mcp\", \"--stdio\"],\n' +
      "    optional env: HAIVE_PROJECT_ROOT (absolute project root).\n\n" +
      "  Updating @hivelore/cli updates MCP; standalone haive-mcp is optional legacy.",
    )
    .option("-d, --dir <dir>", "project root (walks up from here for .ai/ / .git/)")
    .option("-r, --root <dir>", "same as --dir (parity with legacy haive-mcp --root)")
    .option("--stdio", "optional marker for client configs — transport is always stdio", false)
    .action(async (opts: McpOptions) => {
      void opts.stdio;
      const raw = opts.root ?? opts.dir;
      const root = raw ? findProjectRoot(raw) : findProjectRoot();
      try {
        await runHaiveMcpStdio({ root });
      } catch (err) {
        ui.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
