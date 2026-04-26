import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  getUsage,
  loadUsageIndex,
  resolveHaivePaths,
} from "@haive/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface PendingOptions {
  scope?: "personal" | "team" | "module";
  dir?: string;
}

export function registerMemoryPending(memory: Command): void {
  memory
    .command("pending")
    .description("List 'proposed' memories awaiting review (sorted by reads desc)")
    .option("--scope <scope>", "filter by scope (personal | team | module)")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: PendingOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const usage = await loadUsageIndex(paths);
      const proposed = all.filter(({ memory: mem }) => {
        if (mem.frontmatter.status !== "proposed") return false;
        if (opts.scope && mem.frontmatter.scope !== opts.scope) return false;
        return true;
      });

      if (proposed.length === 0) {
        ui.info("No memories awaiting review.");
        return;
      }

      proposed.sort(
        (a, b) =>
          getUsage(usage, b.memory.frontmatter.id).read_count -
          getUsage(usage, a.memory.frontmatter.id).read_count,
      );

      const now = Date.now();
      for (const { memory: mem, filePath } of proposed) {
        const fm = mem.frontmatter;
        const u = getUsage(usage, fm.id);
        const ageDays = Math.floor((now - new Date(fm.created_at).getTime()) / 86_400_000);
        const ageStr = ageDays === 0 ? "today" : `${ageDays}d`;
        console.log(
          `${ui.bold(fm.id)}  ${ui.dim(`${fm.scope}/${fm.type}`)}  ${ui.dim(`age=${ageStr} reads=${u.read_count} rejections=${u.rejected_count}`)}`,
        );
        console.log(`  ${ui.dim(path.relative(root, filePath))}`);
      }
      ui.info(`${proposed.length} pending`);
    });
}
