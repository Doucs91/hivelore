import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  DEFAULT_AUTO_PROMOTE_RULE,
  findProjectRoot,
  getUsage,
  isAutoPromoteEligible,
  loadUsageIndex,
  resolveHaivePaths,
  serializeMemory,
} from "@haive/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface AutoPromoteOptions {
  minReads?: string;
  maxRejections?: string;
  apply?: boolean;
  dir?: string;
}

export function registerMemoryAutoPromote(memory: Command): void {
  memory
    .command("auto-promote")
    .description("Promote eligible 'proposed' memories to 'validated' based on usage")
    .option("--min-reads <n>", "minimum read_count to qualify", String(DEFAULT_AUTO_PROMOTE_RULE.minReads))
    .option(
      "--max-rejections <n>",
      "memories with more rejections than this are skipped",
      String(DEFAULT_AUTO_PROMOTE_RULE.maxRejections),
    )
    .option("--apply", "actually write status=validated to disk (default: dry-run)")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: AutoPromoteOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }

      const rule = {
        minReads: Number(opts.minReads ?? DEFAULT_AUTO_PROMOTE_RULE.minReads),
        maxRejections: Number(opts.maxRejections ?? DEFAULT_AUTO_PROMOTE_RULE.maxRejections),
      };

      const memories = await loadMemoriesFromDir(paths.memoriesDir);
      const usage = await loadUsageIndex(paths);
      const eligible = memories.filter(({ memory }) =>
        isAutoPromoteEligible(memory.frontmatter, getUsage(usage, memory.frontmatter.id), rule),
      );

      if (eligible.length === 0) {
        ui.info(
          `No memories eligible (minReads=${rule.minReads}, maxRejections=${rule.maxRejections}).`,
        );
        return;
      }

      let written = 0;
      for (const { memory: mem, filePath } of eligible) {
        const u = getUsage(usage, mem.frontmatter.id);
        console.log(
          `${ui.bold(opts.apply ? "PROMOTE" : "would promote")}  ${mem.frontmatter.id}  ${ui.dim(`reads=${u.read_count} rejections=${u.rejected_count}`)}`,
        );
        console.log(`             ${ui.dim(path.relative(root, filePath))}`);
        if (opts.apply) {
          const next = {
            frontmatter: { ...mem.frontmatter, status: "validated" as const },
            body: mem.body,
          };
          await writeFile(filePath, serializeMemory(next), "utf8");
          written++;
        }
      }

      const summary = `${eligible.length} eligible`;
      ui.info(opts.apply ? `${summary} · ${written} promoted` : `${summary} · dry-run (use --apply)`);
    });
}
