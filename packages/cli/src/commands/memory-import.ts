import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Command } from "commander";
import {
  findProjectRoot,
  resolveHaivePaths,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

interface ImportOptions {
  from: string;
  scope?: "personal" | "team";
  dir?: string;
}

export function registerMemoryImport(memory: Command): void {
  memory
    .command("import")
    .description(
      "Parse a Markdown file and suggest memories via the import_docs MCP prompt (prints a ready-to-use prompt invocation)",
    )
    .requiredOption("--from <file>", "Markdown/text file to import from")
    .option("--scope <scope>", "personal | team (default: team)", "team")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: ImportOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);

      if (!existsSync(paths.haiveDir)) {
        ui.error(`No .ai/ found at ${root}. Run \`hivelore init\` first.`);
        process.exitCode = 1;
        return;
      }

      if (!existsSync(opts.from)) {
        ui.error(`File not found: ${opts.from}`);
        process.exitCode = 1;
        return;
      }

      const content = await readFile(opts.from, "utf8");
      const scope = opts.scope ?? "team";

      ui.info(`Preparing import from: ${opts.from}  (scope=${scope})`);
      ui.info(`Content length: ${content.length} chars`);
      console.log();
      console.log(ui.bold("To import via MCP, invoke the `import_docs` prompt with:"));
      console.log();
      console.log(
        ui.dim(
          JSON.stringify(
            {
              content: content.slice(0, 200) + (content.length > 200 ? "…" : ""),
              source: opts.from,
              scope,
            },
            null,
            2,
          ),
        ),
      );
      console.log();
      ui.info(
        "Or use your AI client to call: import_docs({ content: <file contents>, source: \"" +
          opts.from +
          "\", scope: \"" +
          scope +
          "\" })",
      );
    });
}
