import path from "node:path";
import { Command } from "commander";
import {
  buildCodeMap,
  codeMapPath,
  findProjectRoot,
  resolveHaivePaths,
  saveCodeMap,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface IndexCodeOptions {
  dir?: string;
  exclude?: string;
}

export function registerIndexCode(program: Command): void {
  const idx = program
    .command("index")
    .description(
      "Build local indexes that let AIs look up symbols instead of grepping.\n\n" +
      "  Run once after init, then haive sync refreshes it automatically when source changes.",
    );
  idx.action(() => idx.help());
  idx
    .command("code")
    .description(
      "Scan source files and write .ai/code-map.json (file → exports + 1-line description).\n\n" +
      "  Supported languages: TypeScript, JavaScript, Java, Python, Go, Rust, C#, PHP.\n" +
      "  The map is used by:\n" +
      "    • get_briefing (symbol_locations) — look up where a class/function lives\n" +
      "    • code_map MCP tool — browse exports without grepping\n" +
      "    • haive briefing --symbols — look up symbols from the CLI\n\n" +
      "  Run automatically by haive init (autopilot mode) and haive sync (if source changed).\n\n" +
      "  Example:\n" +
      "    haive index code\n" +
      "    haive index code --exclude generated,proto\n",
    )
    .option("-d, --dir <dir>", "project root")
    .option(
      "--exclude <csv>",
      "extra directory names to skip (comma-separated)",
      "",
    )
    .action(async (opts: IndexCodeOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const extraExcludes = (opts.exclude ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      ui.info(`Indexing source files in ${root}…`);
      const map = await buildCodeMap(root, {
        excludeDirs: [
          "node_modules",
          "dist",
          "build",
          "out",
          ".git",
          ".next",
          ".turbo",
          ".vitest-cache",
          "coverage",
          ...extraExcludes,
        ],
      });

      await saveCodeMap(paths, map);
      const fileCount = Object.keys(map.files).length;
      const exportCount = Object.values(map.files).reduce((s, f) => s + f.exports.length, 0);
      ui.success(
        `Indexed ${fileCount} file(s) with ${exportCount} export(s) → ${path.relative(root, codeMapPath(paths))}`,
      );
    });

  idx
    .command("code-search")
    .description(
      "Build the semantic-search embeddings index for code (powers the code_search MCP tool).\n\n" +
      "  Reads .ai/code-map.json (run `haive index code` first) and embeds each exported\n" +
      "  symbol's metadata (filename + name + kind + description).\n\n" +
      "  Re-runs are incremental: unchanged entries keep their cached vectors, only the\n" +
      "  diff is re-embedded. First run downloads the bge-small-en-v1.5 model (~110MB).\n",
    )
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: IndexCodeOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);

      let mod: typeof import("@hiveai/embeddings");
      try {
        mod = await import("@hiveai/embeddings");
      } catch {
        ui.error(
          "@hiveai/embeddings is not installed. Install it (`pnpm add @hiveai/embeddings`) " +
          "or run `haive embeddings install`.",
        );
        process.exit(1);
      }

      ui.info("Loading embedder (first run downloads ~110MB)…");
      const embedder = await mod.Embedder.create();
      ui.info(`Embedding code-map symbols…`);
      try {
        const { report } = await mod.rebuildCodeIndex(paths, embedder);
        ui.success(
          `Code-search index ready: ${report.total} symbols ` +
          `(+${report.added} new, ~${report.updated} updated, =${report.unchanged} cached, -${report.removed} removed)`,
        );
      } catch (err) {
        ui.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
