import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Command } from "commander";
import {
  findProjectRoot,
  loadUsageIndex,
  recordRejection,
  resolveHaivePaths,
  saveUsageIndex,
  serializeMemory,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface RejectOptions {
  reason?: string;
  dir?: string;
}

export function registerMemoryReject(memory: Command): void {
  memory
    .command("reject <id>")
    .description("Record a rejection (blocks auto-promotion and lowers confidence)")
    .option("-r, --reason <reason>", "why this memory is being rejected")
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: RejectOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }

      const memories = await loadMemoriesFromDir(paths.memoriesDir);
      const loaded = memories.find((m) => m.memory.frontmatter.id === id);
      if (!loaded) {
        ui.error(`No memory with id "${id}".`);
        process.exitCode = 1;
        return;
      }

      await writeFile(
        loaded.filePath,
        serializeMemory({
          frontmatter: {
            ...loaded.memory.frontmatter,
            status: "rejected",
            stale_reason: opts.reason ?? loaded.memory.frontmatter.stale_reason ?? null,
          },
          body: loaded.memory.body,
        }),
        "utf8",
      );

      const idx = await loadUsageIndex(paths);
      recordRejection(idx, id, opts.reason ?? null);
      await saveUsageIndex(paths, idx);
      const u = idx.by_id[id]!;
      ui.success(
        `Rejected ${id} (status=rejected, ${u.rejected_count} rejection${u.rejected_count === 1 ? "" : "s"})`,
      );
      if (opts.reason) ui.info(`reason: ${opts.reason}`);
    });
}
