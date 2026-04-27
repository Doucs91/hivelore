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
  type MemoryScope,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface QueryOptions {
  dir?: string;
  limit?: string;
  scope?: MemoryScope;
  status?: string;
}

export function registerMemoryQuery(memory: Command): void {
  memory
    .command("query <text>")
    .description("Search memories by id, tag, or substring (multi-word AND)")
    .option("-d, --dir <dir>", "project root")
    .option("--limit <n>", "max results", "20")
    .option("--scope <scope>", "personal | team | module")
    .option("--status <csv>", "filter by status (draft,proposed,validated,stale,rejected)")
    .action(async (text: string, opts: QueryOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No memories directory at ${paths.memoriesDir}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const tokens = tokenizeQuery(text);
      const statusFilter = opts.status ? opts.status.split(",").map((s) => s.trim()) : null;
      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const matches = all.filter(({ memory: mem }) => {
        const fm = mem.frontmatter;
        if (opts.scope && fm.scope !== opts.scope) return false;
        if (statusFilter && !statusFilter.includes(fm.status)) return false;
        return literalMatchesAllTokens(mem, tokens);
      });

      const limit = Math.max(1, Number(opts.limit ?? 20));
      const top = matches.slice(0, limit);

      if (top.length === 0) {
        ui.info(`No matches for "${text}".`);
        return;
      }

      const snippetNeedle = pickSnippetNeedle(text);
      for (const { memory: mem, filePath } of top) {
        const fm = mem.frontmatter;
        const statusBadge = ui.statusBadge(fm.status);
        console.log(`${ui.bold(fm.id)} ${ui.dim(fm.scope)} ${statusBadge}`);
        console.log(`  ${ui.dim(path.relative(root, filePath))}`);
        const snippet = extractSnippet(mem.body, snippetNeedle);
        if (snippet) console.log(`  ${snippet}`);
      }
      console.log(
        ui.dim(`\n${top.length} of ${matches.length} match${matches.length === 1 ? "" : "es"}`),
      );
    });
}
