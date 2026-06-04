import {
  applyFeedbackAdjustment,
  computeImpact,
  getUsage,
  loadMemoriesFromDir,
  loadUsageIndex,
  recordApplied,
  recordRejection,
  recommendFeedbackAdjustment,
  saveUsageIndex,
  serializeMemory,
  type ImpactTier,
  type FeedbackAdjustment,
} from "@hiveai/core";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemFeedbackInputSchema = {
  id: z.string().min(1).describe("Full memory id the feedback is about"),
  outcome: z
    .enum(["applied", "rejected"])
    .describe(
      "'applied' = this memory changed what you did (strong positive utility signal); " +
        "'rejected' = it was wrong/outdated/unhelpful (negative signal, blocks auto-promotion).",
    ),
  reason: z
    .string()
    .optional()
    .describe("Why it was rejected (stored on the memory's usage record). Only used for outcome='rejected'."),
};

export type MemFeedbackInput = {
  [K in keyof typeof MemFeedbackInputSchema]: z.infer<(typeof MemFeedbackInputSchema)[K]>;
};

export interface MemFeedbackOutput {
  ok: boolean;
  id: string;
  outcome?: "applied" | "rejected";
  error?: string;
  usage?: {
    read_count: number;
    applied_count: number;
    rejected_count: number;
  };
  impact?: {
    score: number;
    tier: ImpactTier;
    signals: string[];
  };
  feedback_adjustment?: FeedbackAdjustment;
}

/**
 * Record a closed-loop utility outcome for a memory. This is what turns hAIve's
 * memory store from a passive index into a learning system: agents report whether
 * a surfaced memory actually steered their work, and that feeds impact scoring
 * (`haive memory impact`) and future pruning/ranking.
 */
export async function memFeedback(
  input: MemFeedbackInput,
  ctx: HaiveContext,
): Promise<MemFeedbackOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { ok: false, id: input.id, error: "No .ai/memories — run `haive init` first." };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const target = all.find((m) => m.memory.frontmatter.id === input.id);
  if (!target) {
    return { ok: false, id: input.id, error: `No memory with id '${input.id}'.` };
  }

  const index = await loadUsageIndex(ctx.paths);
  if (input.outcome === "applied") {
    recordApplied(index, input.id);
  } else {
    recordRejection(index, input.id, input.reason ?? null);
  }
  await saveUsageIndex(ctx.paths, index);

  const usage = getUsage(index, input.id);
  const adjustment = input.outcome === "rejected"
    ? recommendFeedbackAdjustment(target.memory.frontmatter, usage)
    : { action: "none" as const, reason: "No automatic adjustment needed." };
  const adjustedFrontmatter = applyFeedbackAdjustment(target.memory.frontmatter, adjustment);
  if (adjustedFrontmatter !== target.memory.frontmatter) {
    target.memory.frontmatter = adjustedFrontmatter;
    await writeFile(target.filePath, serializeMemory(target.memory), "utf8");
  }
  const impact = computeImpact(target.memory.frontmatter, usage);

  return {
    ok: true,
    id: input.id,
    outcome: input.outcome,
    usage: {
      read_count: usage.read_count,
      applied_count: usage.applied_count,
      rejected_count: usage.rejected_count,
    },
    impact: { score: impact.score, tier: impact.tier, signals: impact.signals },
    feedback_adjustment: adjustment,
  };
}
