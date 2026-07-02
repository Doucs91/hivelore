import { existsSync } from "node:fs";
import { collectTimelineEntries, loadMemoriesFromDir } from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemTimelineInputSchema = {
  memory_id: z.string().optional().describe("Seed id — expands via related_ids, topic, anchors"),
  topic: z
    .string()
    .optional()
    .describe("Frontmatter.topic value — chronological list when memory_id omitted"),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(30)
    .describe("Max timeline entries returned"),
};

export type MemTimelineInput = {
  [K in keyof typeof MemTimelineInputSchema]: z.infer<(typeof MemTimelineInputSchema)[K]>;
};

export async function memTimeline(input: MemTimelineInput, ctx: HaiveContext) {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { entries: [], total: 0, notice: "No .ai/memories directory." };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const { entries, notice } = collectTimelineEntries(all, {
    memoryId: input.memory_id,
    topic: input.topic,
    limit: input.limit,
  });
  return { entries, total: entries.length, notice };
}
