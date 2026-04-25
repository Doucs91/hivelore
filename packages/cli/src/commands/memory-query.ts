import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProjectRoot, resolveHaivePaths } from "@haive/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface QueryOptions {
  dir?: string;
  limit?: string;
}

export function registerMemoryQuery(memory: Command): void {
  memory
    .command("query <text>")
    .description("Search memories by id, tag, or substring in body (basic v0.1)")
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

      const needle = text.toLowerCase();
      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const matches = all.filter(({ memory: mem }) => {
        const fm = mem.frontmatter;
        if (fm.id.toLowerCase().includes(needle)) return true;
        if (fm.tags.some((t) => t.toLowerCase().includes(needle))) return true;
        if (mem.body.toLowerCase().includes(needle)) return true;
        return false;
      });

      const limit = Math.max(1, Number(opts.limit ?? 20));
      const top = matches.slice(0, limit);

      if (top.length === 0) {
        ui.info(`No matches for "${text}".`);
        return;
      }

      for (const { memory: mem, filePath } of top) {
        const snippet = extractSnippet(mem.body, needle);
        console.log(`${ui.bold(mem.frontmatter.id)} ${ui.dim(mem.frontmatter.scope)}`);
        console.log(`  ${ui.dim(path.relative(root, filePath))}`);
        if (snippet) console.log(`  ${snippet}`);
      }
      console.log(
        ui.dim(`\n${top.length} of ${matches.length} match${matches.length === 1 ? "" : "es"}`),
      );
    });
}

function extractSnippet(body: string, needle: string): string | null {
  const lower = body.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) return null;
  const start = Math.max(0, idx - 30);
  const end = Math.min(body.length, idx + needle.length + 30);
  const snippet = body.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + snippet + (end < body.length ? "…" : "");
}
