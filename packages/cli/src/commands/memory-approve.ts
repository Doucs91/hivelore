import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  resolveHaivePaths,
  serializeMemory,
} from "@haive/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface ApproveOptions {
  dir?: string;
}

export function registerMemoryApprove(memory: Command): void {
  memory
    .command("approve <id>")
    .description("Mark a 'proposed' memory as 'validated' immediately (explicit review)")
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: ApproveOptions) => {
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

      const current = found.memory.frontmatter.status;
      if (current === "validated") {
        ui.info(`${id} is already validated.`);
        return;
      }
      if (current !== "proposed" && current !== "draft") {
        ui.warn(`Memory has status "${current}"; approve still sets it to validated.`);
      }

      const next = {
        frontmatter: { ...found.memory.frontmatter, status: "validated" as const },
        body: found.memory.body,
      };
      await writeFile(found.filePath, serializeMemory(next), "utf8");
      ui.success(`Approved ${id} (status=validated)`);
      ui.info(path.relative(root, found.filePath));
    });
}
