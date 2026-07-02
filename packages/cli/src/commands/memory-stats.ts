import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  deriveConfidence,
  findProjectRoot,
  getUsage,
  loadUsageIndex,
  resolveHaivePaths,
} from "@hivelore/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface StatsOptions {
  hot?: boolean;
  threshold?: string;
  id?: string;
  dir?: string;
}

export function registerMemoryStats(memory: Command): void {
  memory
    .command("stats")
    .description("Show usage stats and confidence levels per memory")
    .option("--id <id>", "show stats for a single memory id")
    .option("--hot", "only unvalidated (draft/proposed) memories read often — promotion candidates (absorbed `memory hot`)")
    .option("--threshold <n>", "with --hot: minimum read_count to qualify", "3")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: StatsOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}. Run \`hivelore init\` first.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const usage = await loadUsageIndex(paths);
      const threshold = Math.max(1, Number(opts.threshold ?? 3));
      const target = (opts.id
        ? all.filter((m) => m.memory.frontmatter.id === opts.id)
        : all
      ).filter((m) => {
        if (!opts.hot) return true;
        const fm = m.memory.frontmatter;
        if (fm.status !== "draft" && fm.status !== "proposed") return false;
        return getUsage(usage, fm.id).read_count >= threshold;
      });

      if (target.length === 0) {
        ui.info(opts.hot ? `No hot memories (threshold=${threshold}).` : opts.id ? `No memory with id "${opts.id}".` : "No memories.");
        return;
      }

      // Sort by read_count desc to surface the popular ones.
      target.sort(
        (a, b) =>
          getUsage(usage, b.memory.frontmatter.id).read_count -
          getUsage(usage, a.memory.frontmatter.id).read_count,
      );

      for (const { memory: mem, filePath } of target) {
        const fm = mem.frontmatter;
        const u = getUsage(usage, fm.id);
        const conf = deriveConfidence(fm, u);
        console.log(
          `${ui.bold(fm.id)}  ${ui.dim(`${fm.scope}/${fm.type}`)}  ${ui.bold(conf)}`,
        );
        console.log(
          `  ${ui.dim("status:")} ${fm.status}  ${ui.dim("reads:")} ${u.read_count}  ${ui.dim("rejections:")} ${u.rejected_count}`,
        );
        console.log(`  ${ui.dim(path.relative(root, filePath))}`);
      }
    });
}
