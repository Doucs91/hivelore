import { existsSync } from "node:fs";
import {
  deriveConfidence,
  getUsage,
  loadMemoriesFromDir,
  loadUsageIndex,
  type ConfidenceLevel,
} from "@haive/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemGetInputSchema = {
  id: z.string().min(1).describe("Memory id to fetch"),
};

export type MemGetInput = {
  [K in keyof typeof MemGetInputSchema]: z.infer<(typeof MemGetInputSchema)[K]>;
};

export interface MemGetOutput {
  id: string;
  scope: string;
  type: string;
  module?: string;
  tags: string[];
  status: string;
  confidence: ConfidenceLevel;
  read_count: number;
  rejected_count: number;
  created_at: string;
  verified_at: string | null;
  stale_reason: string | null;
  anchor: { commit?: string; paths: string[]; symbols: string[] };
  body: string;
  file_path: string;
}

export async function memGet(input: MemGetInput, ctx: HaiveContext): Promise<MemGetOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    throw new Error(`No .ai/memories at ${ctx.paths.root}.`);
  }
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const found = all.find((m) => m.memory.frontmatter.id === input.id);
  if (!found) throw new Error(`No memory with id "${input.id}".`);
  const fm = found.memory.frontmatter;
  const u = getUsage(await loadUsageIndex(ctx.paths), fm.id);
  return {
    id: fm.id,
    scope: fm.scope,
    type: fm.type,
    ...(fm.module ? { module: fm.module } : {}),
    tags: fm.tags,
    status: fm.status,
    confidence: deriveConfidence(fm, u),
    read_count: u.read_count,
    rejected_count: u.rejected_count,
    created_at: fm.created_at,
    verified_at: fm.verified_at,
    stale_reason: fm.stale_reason,
    anchor: {
      ...(fm.anchor.commit ? { commit: fm.anchor.commit } : {}),
      paths: fm.anchor.paths,
      symbols: fm.anchor.symbols,
    },
    body: found.memory.body,
    file_path: found.filePath,
  };
}
