import { z } from "zod";
import {
  getBriefing,
  type BriefingMemory,
  type BriefingQuality,
  type GetBriefingInput,
} from "./get-briefing.js";
import type { HaiveContext } from "../context.js";

export const MemRelevantToInputSchema = {
  task: z
    .string()
    .min(1)
    .describe("What you are about to do, in 1–2 sentences. Used to rank relevant memories."),
  files: z
    .array(z.string())
    .default([])
    .describe("Optional: files you are about to edit — surfaces anchored memories."),
  limit: z
    .number()
    .int()
    .positive()
    .max(30)
    .default(8)
    .describe("Cap on returned memories."),
  min_semantic_score: z
    .number()
    .min(0)
    .max(1)
    .default(0.25)
    .describe("Drop weakly-related semantic hits below this cosine threshold."),
  format: z
    .enum(["full", "compact", "actions"])
    .default("full")
    .describe("'compact' = id + 1-line summary; 'full' = complete bodies; 'actions' = bullet-first excerpts."),
};

export type MemRelevantToInput = {
  [K in keyof typeof MemRelevantToInputSchema]: z.infer<(typeof MemRelevantToInputSchema)[K]>;
};

export interface MemRelevantToOutput {
  task: string;
  search_mode: "semantic" | "literal_fallback" | "literal";
  memories: BriefingMemory[];
  briefing_quality: BriefingQuality;
  hints?: string[];
  /**
   * True when the search returned zero memories — clients can skip surfacing
   * an empty payload to the model.
   */
  empty?: true;
}

/**
 * One-shot ranked memories for a task. Use instead of get_briefing when you
 * already have project context loaded and only want the relevant memory layer.
 *
 * Runs the same ranking (anchor / module / literal / semantic) as get_briefing
 * but skips project_context, module_contexts, action_required, etc. — paying
 * only the cost of the memory bodies you actually get back.
 */
export async function memRelevantTo(
  input: MemRelevantToInput,
  ctx: HaiveContext,
): Promise<MemRelevantToOutput> {
  // Reuse the briefing pipeline but turn off the heavy bits.
  const briefingInput: GetBriefingInput = {
    task: input.task,
    files: input.files,
    max_tokens: 16000,
    max_memories: input.limit,
    include_project_context: false,
    include_module_contexts: false,
    semantic: true,
    include_stale: false,
    track: true,
    format: input.format,
    symbols: [],
    min_semantic_score: input.min_semantic_score,
  };

  const briefing = await getBriefing(briefingInput, ctx);

  const out: MemRelevantToOutput = {
    task: input.task,
    search_mode: briefing.search_mode,
    memories: briefing.memories,
    briefing_quality: briefing.briefing_quality,
  };
  if (briefing.hints && briefing.hints.length > 0) out.hints = briefing.hints;
  if (briefing.memories.length === 0) out.empty = true;
  return out;
}
