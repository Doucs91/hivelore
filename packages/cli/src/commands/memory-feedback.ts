import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import {
  applyFeedbackAdjustment,
  computeImpact,
  findProjectRoot,
  getUsage,
  loadUsageIndex,
  recordApplied,
  recordRejection,
  recommendFeedbackAdjustment,
  resolveHaivePaths,
  saveUsageIndex,
  serializeMemory,
} from "@hivelore/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface FeedbackOptions {
  applied?: boolean;
  rejected?: boolean;
  reason?: string;
  json?: boolean;
  dir?: string;
}

export function registerMemoryFeedback(memory: Command): void {
  memory
    .command("feedback <id>")
    .description(
      "Record whether a memory actually helped — the closed-loop utility signal " +
        "(mirror of the mem_feedback MCP tool). 'applied' = it steered your work; " +
        "'rejected' = it was wrong/unhelpful. Feeds `hivelore memory impact`.",
    )
    .option("--applied", "the memory changed what you did (positive signal)", false)
    .option("--rejected", "the memory was wrong/outdated/unhelpful (negative signal)", false)
    .option("--reason <text>", "why it was rejected (stored on the usage record)")
    .option("--json", "emit JSON", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: FeedbackOptions) => {
      if (opts.applied === opts.rejected) {
        ui.error("Specify exactly one of --applied or --rejected.");
        process.exitCode = 1;
        return;
      }
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}. Run \`hivelore init\` first.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const target = all.find((m) => m.memory.frontmatter.id === id);
      if (!target) {
        ui.error(`No memory with id '${id}'.`);
        process.exitCode = 1;
        return;
      }

      const index = await loadUsageIndex(paths);
      const outcome = opts.applied ? "applied" : "rejected";
      if (opts.applied) recordApplied(index, id);
      else recordRejection(index, id, opts.reason ?? null);
      await saveUsageIndex(paths, index);

      const usage = getUsage(index, id);
      const adjustment = opts.rejected
        ? recommendFeedbackAdjustment(target.memory.frontmatter, usage)
        : { action: "none" as const, reason: "No automatic adjustment needed." };
      const adjustedFrontmatter = applyFeedbackAdjustment(target.memory.frontmatter, adjustment);
      if (adjustedFrontmatter !== target.memory.frontmatter) {
        target.memory.frontmatter = adjustedFrontmatter;
        await writeFile(target.filePath, serializeMemory(target.memory), "utf8");
      }
      const impact = computeImpact(target.memory.frontmatter, usage);

      if (opts.json) {
        console.log(JSON.stringify({ id, outcome, usage, impact, feedback_adjustment: adjustment }, null, 2));
        return;
      }

      ui.success(`Recorded '${outcome}' for ${id}`);
      ui.info(
        `applied=${usage.applied_count} · rejected=${usage.rejected_count} · read=${usage.read_count} ` +
          `→ impact ${impact.score.toFixed(2)} (${impact.tier})`,
      );
      if (adjustment.action !== "none") {
        ui.warn(`Feedback adjustment: ${adjustment.action} — ${adjustment.reason}`);
      }
    });
}
