import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  extractSnippet,
  findProjectRoot,
  literalMatchesAllTokens,
  pickSnippetNeedle,
  resolveHaivePaths,
  tokenizeQuery,
} from "@haive/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface QueryOptions {
  dir?: string;
  limit?: string;
}

export function registerMemoryQuery(memory: Command): void {
  memory
    .command("query <text>")
    .description("Search memories by id, tag, or substring (multi-word AND)")
    .option("-d, --dir <dir>", "project root")
    .option("--limit <n>", "max results", "20")
    .action(async (text: string, opts: QueryOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No memories directory at ${paths.memoriesDir}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const tokens = tokenizeQuery(text);
      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const matches = all.filter(({ memory: mem }) => literalMatchesAllTokens(mem, tokens));

      const limit = Math.max(1, Number(opts.limit ?? 20));
      const top = matches.slice(0, limit);

      if (top.length === 0) {
        ui.info(`No matches for "${text}".`);
        return;
      }

      const snippetNeedle = pickSnippetNeedle(text);
      for (const { memory: mem, filePath } of top) {
        const snippet = extractSnippet(mem.body, snippetNeedle);
        console.log(`${ui.bold(mem.frontmatter.id)} ${ui.dim(mem.frontmatter.scope)}`);
        console.log(`  ${ui.dim(path.relative(root, filePath))}`);
        if (snippet) console.log(`  ${snippet}`);
      }
      console.log(
        ui.dim(`\n${top.length} of ${matches.length} match${matches.length === 1 ? "" : "es"}`),
      );
    });
}
