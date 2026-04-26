import { existsSync } from "node:fs";
import { loadMemoriesFromDir } from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemListInputSchema = {
  scope: z.enum(["personal", "team", "module"]).optional(),
  type: z
    .enum(["convention", "decision", "gotcha", "architecture", "glossary"])
    .optional(),
  module: z.string().optional(),
  tag: z.string().optional(),
};

export type MemListInput = {
  [K in keyof typeof MemListInputSchema]: z.infer<(typeof MemListInputSchema)[K]>;
};

export interface MemSummary {
  id: string;
  scope: string;
  type: string;
  module?: string;
  status: string;
  tags: string[];
  file_path: string;
}

export async function memList(
  input: MemListInput,
  ctx: HaiveContext,
): Promise<{ memories: MemSummary[] }> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { memories: [] };
  }
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const filtered = all.filter(({ memory }) => {
    const fm = memory.frontmatter;
    if (input.scope && fm.scope !== input.scope) return false;
    if (input.type && fm.type !== input.type) return false;
    if (input.module && fm.module !== input.module) return false;
    if (input.tag && !fm.tags.includes(input.tag)) return false;
    return true;
  });
  const memories: MemSummary[] = filtered.map(({ memory, filePath }) => {
    const fm = memory.frontmatter;
    return {
      id: fm.id,
      scope: fm.scope,
      type: fm.type,
      ...(fm.module ? { module: fm.module } : {}),
      status: fm.status,
      tags: fm.tags,
      file_path: filePath,
    };
  });
  return { memories };
}
