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
  include_body: z
    .boolean()
    .default(false)
    .describe("Include full body text. Default false to save tokens — use mem_get for a single memory's full content."),
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
  snippet: string;
  file_path: string;
  body?: string;
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
    const snippet = memory.body.replace(/\s+/g, " ").trim().slice(0, 120);
    return {
      id: fm.id,
      scope: fm.scope,
      type: fm.type,
      ...(fm.module ? { module: fm.module } : {}),
      status: fm.status,
      tags: fm.tags,
      snippet,
      file_path: filePath,
      ...(input.include_body ? { body: memory.body } : {}),
    };
  });
  return { memories };
}
