import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  deriveConfidence,
  getUsage,
  inferModulesFromPaths,
  loadMemoriesFromDir,
  loadUsageIndex,
  memoryMatchesAnchorPaths,
  trackReads,
  type ConfidenceLevel,
  type LoadedMemory,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemForFilesInputSchema = {
  files: z
    .array(z.string())
    .min(1)
    .describe("Project-relative file paths the agent is currently working on"),
  include_module_contexts: z
    .boolean()
    .default(true)
    .describe("Inline the matching .ai/modules/<name>/context.md contents"),
  track: z
    .boolean()
    .default(true)
    .describe("Increment read_count on returned memories"),
};

export type MemForFilesInput = {
  [K in keyof typeof MemForFilesInputSchema]: z.infer<(typeof MemForFilesInputSchema)[K]>;
};

export interface MemMatch {
  id: string;
  scope: string;
  type: string;
  module?: string;
  tags: string[];
  status: string;
  confidence: ConfidenceLevel;
  read_count: number;
  reason: "anchor_overlap" | "module" | "domain";
  file_path: string;
  body: string;
}

export interface MemForFilesOutput {
  inferred_modules: string[];
  by_anchor: MemMatch[];
  by_module: MemMatch[];
  by_domain: MemMatch[];
  module_contexts: Array<{ name: string; content: string }>;
}

export async function memForFiles(
  input: MemForFilesInput,
  ctx: HaiveContext,
): Promise<MemForFilesOutput> {
  const inferred = inferModulesFromPaths(input.files);

  if (!existsSync(ctx.paths.memoriesDir)) {
    return {
      inferred_modules: inferred,
      by_anchor: [],
      by_module: [],
      by_domain: [],
      module_contexts: await loadModuleContexts(ctx, inferred, input.include_module_contexts),
    };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const usage = await loadUsageIndex(ctx.paths);
  const seen = new Set<string>();

  const byAnchor: MemMatch[] = [];
  const byModule: MemMatch[] = [];
  const byDomain: MemMatch[] = [];

  for (const loaded of all) {
    if (memoryMatchesAnchorPaths(loaded.memory, input.files)) {
      byAnchor.push(toMatch(loaded, "anchor_overlap", usage));
      seen.add(loaded.memory.frontmatter.id);
    }
  }

  for (const loaded of all) {
    if (seen.has(loaded.memory.frontmatter.id)) continue;
    const mod = loaded.memory.frontmatter.module;
    if (mod && inferred.includes(mod)) {
      byModule.push(toMatch(loaded, "module", usage));
      seen.add(loaded.memory.frontmatter.id);
    }
  }

  for (const loaded of all) {
    if (seen.has(loaded.memory.frontmatter.id)) continue;
    const domain = loaded.memory.frontmatter.domain;
    if (domain && inferred.includes(domain)) {
      byDomain.push(toMatch(loaded, "domain", usage));
      seen.add(loaded.memory.frontmatter.id);
    }
  }

  if (input.track) {
    await trackReads(ctx.paths, [...seen]);
  }

  return {
    inferred_modules: inferred,
    by_anchor: byAnchor,
    by_module: byModule,
    by_domain: byDomain,
    module_contexts: await loadModuleContexts(ctx, inferred, input.include_module_contexts),
  };
}

function toMatch(
  loaded: LoadedMemory,
  reason: MemMatch["reason"],
  usage: Parameters<typeof getUsage>[0],
): MemMatch {
  const fm = loaded.memory.frontmatter;
  const u = getUsage(usage, fm.id);
  return {
    id: fm.id,
    scope: fm.scope,
    type: fm.type,
    ...(fm.module ? { module: fm.module } : {}),
    tags: fm.tags,
    status: fm.status,
    confidence: deriveConfidence(fm, u),
    read_count: u.read_count,
    reason,
    file_path: loaded.filePath,
    body: loaded.memory.body,
  };
}

async function loadModuleContexts(
  ctx: HaiveContext,
  modules: string[],
  enabled: boolean,
): Promise<Array<{ name: string; content: string }>> {
  if (!enabled || modules.length === 0) return [];
  if (!existsSync(ctx.paths.modulesContextDir)) return [];
  const available = new Set(
    (await readdir(ctx.paths.modulesContextDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name),
  );
  const out: Array<{ name: string; content: string }> = [];
  for (const m of modules) {
    if (!available.has(m)) continue;
    const file = path.join(ctx.paths.modulesContextDir, m, "context.md");
    if (existsSync(file)) {
      out.push({ name: m, content: await readFile(file, "utf8") });
    }
  }
  return out;
}
