import { existsSync } from "node:fs";
import { loadMemoriesFromDir } from "@haive/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemSearchInputSchema = {
  query: z.string().describe("Substring matched against id, tags, and body"),
  scope: z
    .enum(["personal", "team", "module"])
    .optional()
    .describe("Restrict results to a single scope"),
  type: z
    .enum(["convention", "decision", "gotcha", "architecture", "glossary"])
    .optional()
    .describe("Restrict results to a memory type"),
  module: z.string().optional().describe("Restrict results to a module"),
  limit: z.number().int().positive().max(100).default(20).describe("Max results"),
};

export type MemSearchInput = {
  [K in keyof typeof MemSearchInputSchema]: z.infer<(typeof MemSearchInputSchema)[K]>;
};

export interface MemSearchHit {
  id: string;
  scope: string;
  type: string;
  module?: string;
  tags: string[];
  status: string;
  snippet: string;
  file_path: string;
}

export async function memSearch(
  input: MemSearchInput,
  ctx: HaiveContext,
): Promise<{ matches: MemSearchHit[]; total: number }> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { matches: [], total: 0 };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const needle = input.query.toLowerCase();

  const filtered = all.filter(({ memory }) => {
    const fm = memory.frontmatter;
    if (input.scope && fm.scope !== input.scope) return false;
    if (input.type && fm.type !== input.type) return false;
    if (input.module && fm.module !== input.module) return false;
    if (fm.id.toLowerCase().includes(needle)) return true;
    if (fm.tags.some((t) => t.toLowerCase().includes(needle))) return true;
    if (memory.body.toLowerCase().includes(needle)) return true;
    return false;
  });

  const top = filtered.slice(0, input.limit);
  const matches: MemSearchHit[] = top.map(({ memory, filePath }) => {
    const fm = memory.frontmatter;
    return {
      id: fm.id,
      scope: fm.scope,
      type: fm.type,
      ...(fm.module ? { module: fm.module } : {}),
      tags: fm.tags,
      status: fm.status,
      snippet: extractSnippet(memory.body, needle),
      file_path: filePath,
    };
  });

  return { matches, total: filtered.length };
}

function extractSnippet(body: string, needle: string): string {
  const lower = body.toLowerCase();
  const idx = lower.indexOf(needle);
  if (idx < 0) return body.slice(0, 120).replace(/\s+/g, " ").trim();
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + needle.length + 40);
  const snippet = body.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + snippet + (end < body.length ? "…" : "");
}
