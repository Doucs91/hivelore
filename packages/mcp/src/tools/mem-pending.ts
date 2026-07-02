import { existsSync } from "node:fs";
import {
  getUsage,
  loadMemoriesFromDir,
  loadUsageIndex,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemPendingInputSchema = {
  scope: z.enum(["personal", "team", "module"]).optional(),
};

export type MemPendingInput = {
  [K in keyof typeof MemPendingInputSchema]: z.infer<(typeof MemPendingInputSchema)[K]>;
};

export interface MemPendingHit {
  id: string;
  scope: string;
  type: string;
  module?: string;
  tags: string[];
  age_days: number;
  read_count: number;
  rejected_count: number;
  file_path: string;
}

export interface MemPendingOutput {
  pending: MemPendingHit[];
}

export async function memPending(
  input: MemPendingInput,
  ctx: HaiveContext,
): Promise<MemPendingOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) return { pending: [] };
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const usage = await loadUsageIndex(ctx.paths);
  const now = Date.now();
  const proposed = all.filter(({ memory }) => {
    if (memory.frontmatter.status !== "proposed") return false;
    if (input.scope && memory.frontmatter.scope !== input.scope) return false;
    return true;
  });

  proposed.sort(
    (a, b) =>
      getUsage(usage, b.memory.frontmatter.id).read_count -
      getUsage(usage, a.memory.frontmatter.id).read_count,
  );

  return {
    pending: proposed.map(({ memory, filePath }) => {
      const fm = memory.frontmatter;
      const u = getUsage(usage, fm.id);
      return {
        id: fm.id,
        scope: fm.scope,
        type: fm.type,
        ...(fm.module ? { module: fm.module } : {}),
        tags: fm.tags,
        age_days: Math.floor((now - new Date(fm.created_at).getTime()) / 86_400_000),
        read_count: u.read_count,
        rejected_count: u.rejected_count,
        file_path: filePath,
      };
    }),
  };
}
