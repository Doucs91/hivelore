import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  resolveHaivePaths,
  serializeMemory,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface ApproveOptions {
  all?: boolean;
  pending?: boolean;
  dir?: string;
}

export function registerMemoryApprove(memory: Command): void {
  memory
    .command("approve [id]")
    .description("Mark a memory as 'validated'. Use --all to bulk-approve all proposed/draft memories.")
    .option("--all", "approve all proposed and draft memories at once")
    .option("--pending", "approve all memories with status 'proposed'")
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string | undefined, opts: ApproveOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);

      // Bulk mode
      if (opts.all || opts.pending) {
        const candidates = all.filter((m) => {
          const s = m.memory.frontmatter.status;
          if (opts.all) return s === "proposed" || s === "draft";
          return s === "proposed";
        });
        if (candidates.length === 0) {
          ui.info(opts.all ? "No draft or proposed memories to approve." : "No proposed memories to approve.");
          return;
        }
        let count = 0;
        for (const found of candidates) {
          const next = {
            // CLI approval is the human surface → record human provenance.
            frontmatter: { ...found.memory.frontmatter, status: "validated" as const, validated_by: "human" as const },
            body: found.memory.body,
          };
          await writeFile(found.filePath, serializeMemory(next), "utf8");
          count++;
        }
        ui.success(`Approved ${count} memor${count === 1 ? "y" : "ies"} (status=validated)`);
        return;
      }

      // Single mode
      if (!id) {
        ui.error("Provide a memory id or use --all / --pending for bulk approval.");
        process.exitCode = 1;
        return;
      }

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
        frontmatter: { ...found.memory.frontmatter, status: "validated" as const, validated_by: "human" as const },
        body: found.memory.body,
      };
      await writeFile(found.filePath, serializeMemory(next), "utf8");
      ui.success(`Approved ${id} (status=validated, by=human)`);
      ui.info(path.relative(root, found.filePath));
    });
}
