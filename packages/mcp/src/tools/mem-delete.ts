import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import {
  loadMemoriesFromDir,
  loadUsageIndex,
  saveUsageIndex,
} from "@haive/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemDeleteInputSchema = {
  id: z.string().min(1).describe("Memory id to delete"),
  keep_usage: z
    .boolean()
    .default(false)
    .describe("Keep the usage.json entry instead of removing it alongside the file"),
};

export type MemDeleteInput = {
  [K in keyof typeof MemDeleteInputSchema]: z.infer<(typeof MemDeleteInputSchema)[K]>;
};

export interface MemDeleteOutput {
  id: string;
  deleted_file: string;
  usage_removed: boolean;
}

export async function memDelete(
  input: MemDeleteInput,
  ctx: HaiveContext,
): Promise<MemDeleteOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    throw new Error(`No .ai/memories at ${ctx.paths.root}.`);
  }
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const found = all.find((m) => m.memory.frontmatter.id === input.id);
  if (!found) throw new Error(`No memory with id "${input.id}".`);

  await unlink(found.filePath);

  let usageRemoved = false;
  if (!input.keep_usage) {
    const idx = await loadUsageIndex(ctx.paths);
    if (idx.by_id[input.id]) {
      delete idx.by_id[input.id];
      await saveUsageIndex(ctx.paths, idx);
      usageRemoved = true;
    }
  }

  return { id: input.id, deleted_file: found.filePath, usage_removed: usageRemoved };
}
