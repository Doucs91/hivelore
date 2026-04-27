import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  getUsage,
  loadUsageIndex,
  resolveHaivePaths,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface HotOptions {
  threshold?: string;
  status?: "draft" | "proposed";
  dir?: string;
}

export function registerMemoryHot(memory: Command): void {
  memory
    .command("hot")
    .description("List memories actively used but not yet validated (good promotion candidates)")
    .option("--threshold <n>", "minimum read_count to qualify", "3")
    .option("--status <status>", "limit to one status (default: draft + proposed)")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: HotOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }
      const threshold = Math.max(1, Number(opts.threshold ?? 3));

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const usage = await loadUsageIndex(paths);
      const candidates = all
        .filter(({ memory: mem }) => {
          const fm = mem.frontmatter;
          if (opts.status && fm.status !== opts.status) return false;
          if (opts.status === undefined && fm.status !== "draft" && fm.status !== "proposed") {
            return false;
          }
          return getUsage(usage, fm.id).read_count >= threshold;
        })
        .sort(
          (a, b) =>
            getUsage(usage, b.memory.frontmatter.id).read_count -
            getUsage(usage, a.memory.frontmatter.id).read_count,
        );

      if (candidates.length === 0) {
        ui.info(`No hot memories (threshold=${threshold}).`);
        return;
      }

      for (const { memory: mem, filePath } of candidates) {
        const fm = mem.frontmatter;
        const u = getUsage(usage, fm.id);
        console.log(
          `${ui.bold(fm.id)}  ${ui.dim(`${fm.scope}/${fm.type}`)}  ${ui.bold(fm.status)}  ${ui.dim(`reads=${u.read_count} rejections=${u.rejected_count}`)}`,
        );
        console.log(`  ${ui.dim(path.relative(root, filePath))}`);
      }
      ui.info(
        `${candidates.length} hot — promote drafts with \`haive memory promote <id>\`, then \`haive memory auto-promote --apply\`.`,
      );
    });
}
