import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  loadMemoriesFromDir,
  loadUsageIndex,
  recordRejection,
  saveUsageIndex,
  serializeMemory,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemRejectInputSchema = {
  id: z.string().min(1).describe("Memory id being rejected"),
  reason: z
    .string()
    .optional()
    .describe("Why this memory is being rejected (recorded for review)"),
};

export type MemRejectInput = {
  [K in keyof typeof MemRejectInputSchema]: z.infer<(typeof MemRejectInputSchema)[K]>;
};

export interface MemRejectOutput {
  id: string;
  status: string;
  rejected_count: number;
  last_rejected_at: string | null;
  rejection_reason: string | null;
}

export async function memReject(
  input: MemRejectInput,
  ctx: HaiveContext,
): Promise<MemRejectOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    throw new Error(`No .ai/memories at ${ctx.paths.root}.`);
  }

  const memories = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const loaded = memories.find((m) => m.memory.frontmatter.id === input.id);
  if (!loaded) throw new Error(`No memory with id "${input.id}".`);

  // Write rejected status to disk
  await writeFile(
    loaded.filePath,
    serializeMemory({
      frontmatter: { ...loaded.memory.frontmatter, status: "rejected" },
      body: loaded.memory.body,
    }),
    "utf8",
  );

  const idx = await loadUsageIndex(ctx.paths);
  recordRejection(idx, input.id, input.reason ?? null);
  await saveUsageIndex(ctx.paths, idx);
  const u = idx.by_id[input.id];
  return {
    id: input.id,
    status: "rejected",
    rejected_count: u?.rejected_count ?? 0,
    last_rejected_at: u?.last_rejected_at ?? null,
    rejection_reason: u?.rejection_reason ?? null,
  };
}
