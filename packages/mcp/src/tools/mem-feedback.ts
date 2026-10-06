import {
  recordReportedOutcome,
  computeImpact,
  getUsage,
  loadMemoriesFromDir,
  loadUsageIndex,
  recordApplied,
  recordRejection,
  recommendFeedbackAdjustment,
  saveUsageIndex,
  type ImpactTier,
  type FeedbackAdjustment,
} from "@hivelore/core";
import { existsSync } from "node:fs";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemFeedbackInputSchema = {
  id: z.string().min(1).describe("Full memory id the feedback is about"),
  outcome: z
    .enum(["applied", "rejected", "corrected", "verified"])
    .describe(
      "'applied' = this memory changed what you did (strong positive utility signal); " +
        "'rejected' = it was wrong/outdated/unhelpful (negative signal, blocks auto-promotion).",
    ),
  reference: z.string().optional().describe("Required for corrected/verified: commit, test report or incident reference (reported, not authenticated)"),
  catch_id: z.string().optional().describe("Catch identity from stats outcomes; verified requires a prior linked correction"),
  session_id: z.string().optional(),
  reason: z
    .string()
    .optional()
    .describe("Why it was rejected (stored on the memory's usage record). Only used for outcome='rejected'."),
};

export type MemFeedbackInput = { id: string; outcome: "applied" | "rejected" | "corrected" | "verified";
  reason?: string; reference?: string; catch_id?: string; session_id?: string; };

export interface MemFeedbackOutput {
  ok: boolean;
  id: string;
  outcome?: MemFeedbackInput["outcome"];
  evidence?: "reported";
  reference?: string;
  catch_id?: string;
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
 * Record a closed-loop utility outcome for a memory. This is what turns Hivelore's
 * memory store from a passive index into a learning system: agents report whether
 * a surfaced memory actually steered their work, and that feeds impact scoring
 * (`hivelore memory impact`) and future pruning/ranking.
 */
export async function memFeedback(
  input: MemFeedbackInput,
  ctx: HaiveContext,
): Promise<MemFeedbackOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { ok: false, id: input.id, error: "No .ai/memories — run `hivelore init` first." };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const target = all.find((m) => m.memory.frontmatter.id === input.id);
  if (!target) {
    return { ok: false, id: input.id, error: `No memory with id '${input.id}'.` };
  }

  try {
    await recordReportedOutcome(ctx.paths, { id: input.id, kind: input.outcome, source: "mcp",
      reference: input.reference, catch_id: input.catch_id, session_id: input.session_id ?? ctx.sessionId });
  } catch (error) { return { ok: false, id: input.id, error: (error as Error).message }; }
  if (input.outcome === "corrected" || input.outcome === "verified") return {
    ok: true, id: input.id, outcome: input.outcome, evidence: "reported", reference: input.reference, catch_id: input.catch_id,
  };
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
