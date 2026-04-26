import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import {
  findProjectRoot,
  loadUsageIndex,
  resolveHaivePaths,
  saveUsageIndex,
} from "@haive/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface RmOptions {
  yes?: boolean;
  keepUsage?: boolean;
  dir?: string;
}

export function registerMemoryRm(memory: Command): void {
  memory
    .command("rm <id>")
    .description("Delete a memory file (and its usage entry by default)")
    .option("-y, --yes", "skip the confirmation prompt")
    .option("--keep-usage", "do not remove the usage.json entry")
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: RmOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const found = all.find((m) => m.memory.frontmatter.id === id);
      if (!found) {
        ui.error(`No memory with id "${id}".`);
        process.exitCode = 1;
        return;
      }

      const rel = path.relative(root, found.filePath);
      if (!opts.yes) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = (await rl.question(`Delete ${rel}? [y/N] `)).trim().toLowerCase();
        rl.close();
        if (answer !== "y" && answer !== "yes") {
          ui.info("Aborted.");
          return;
        }
      }

      await unlink(found.filePath);
      ui.success(`Deleted ${rel}`);

      if (!opts.keepUsage) {
        const idx = await loadUsageIndex(paths);
        if (idx.by_id[id]) {
          delete idx.by_id[id];
          await saveUsageIndex(paths, idx);
          ui.info("Removed usage entry");
        }
      }
    });
}
