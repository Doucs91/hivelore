import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  loadMemoriesFromDir,
  serializeMemory,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemApproveInputSchema = {
  id: z.string().min(1).describe("Memory id to approve (sets status=validated immediately)"),
};

export type MemApproveInput = {
  [K in keyof typeof MemApproveInputSchema]: z.infer<(typeof MemApproveInputSchema)[K]>;
};

export interface MemApproveOutput {
  id: string;
  previous_status: string;
  status: "validated";
  file_path: string;
}

export async function memApprove(
  input: MemApproveInput,
  ctx: HaiveContext,
): Promise<MemApproveOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    throw new Error(`No .ai/memories at ${ctx.paths.root}.`);
  }
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const found = all.find((m) => m.memory.frontmatter.id === input.id);
  if (!found) throw new Error(`No memory with id "${input.id}".`);

  const previous = found.memory.frontmatter.status;
  const next = {
    frontmatter: { ...found.memory.frontmatter, status: "validated" as const },
    body: found.memory.body,
  };
  await writeFile(found.filePath, serializeMemory(next), "utf8");
  return {
    id: input.id,
    previous_status: previous,
    status: "validated",
    file_path: found.filePath,
  };
}
