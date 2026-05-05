import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  collectTimelineEntries,
  findProjectRoot,
  resolveHaivePaths,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface TimelineOpts {
  id?: string;
  topic?: string;
  limit: string;
  dir?: string;
}

export function registerMemoryTimeline(memory: Command): void {
  memory
    .command("timeline")
    .description(
      "List related memories chronologically (topic, related_ids, anchors) — same logic as MCP mem_timeline.",
    )
    .option("--id <id>", "seed memory id")
    .option("--topic <key>", "filter by frontmatter.topic (use without --id for topic-only)")
    .option("-n, --limit <n>", "max entries", "30")
    .option("-d, --dir <dir>", "project root", process.cwd())
    .action(async (opts: TimelineOpts) => {
      if (!opts.id && !opts.topic) {
        ui.error("Provide --id and/or --topic.");
        process.exitCode = 1;
        return;
      }
      const root = path.resolve(opts.dir ?? process.cwd());
      const paths = resolveHaivePaths(findProjectRoot(root));
      if (!existsSync(paths.memoriesDir)) {
        ui.error("No memories — run `haive init`.");
        process.exitCode = 1;
        return;
      }
      const limit = Math.min(100, Math.max(1, parseInt(opts.limit, 10) || 30));
      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const { entries, notice } = collectTimelineEntries(all, {
        memoryId: opts.id,
        topic: opts.topic,
        limit,
      });
      if (notice) ui.warn(notice);
      console.log(JSON.stringify({ entries, total: entries.length }, null, 2));
    });
}
