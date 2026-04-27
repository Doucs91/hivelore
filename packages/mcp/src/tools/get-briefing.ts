import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  allocateBudget,
  deriveConfidence,
  estimateTokens,
  getUsage,
  inferModulesFromPaths,
  literalMatchesAllTokens,
  loadMemoriesFromDir,
  loadUsageIndex,
  memoryMatchesAnchorPaths,
  tokenizeQuery,
  trackReads,
  truncateToTokens,
  type ConfidenceLevel,
  type LoadedMemory,
  type UsageIndex,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const GetBriefingInputSchema = {
  task: z
    .string()
    .optional()
    .describe(
      "What you are about to do, in 1–2 sentences. Used to rank relevant memories semantically.",
    ),
  files: z
    .array(z.string())
    .default([])
    .describe("Project-relative file paths the agent is currently looking at or about to edit"),
  max_tokens: z
    .number()
    .int()
    .positive()
    .default(8000)
    .describe(
      "Approximate token budget for the entire briefing. Each section is allocated a share and truncated to fit.",
    ),
  max_memories: z
    .number()
    .int()
    .positive()
    .default(8)
    .describe("Cap on memories surfaced regardless of token budget"),
  include_project_context: z.boolean().default(true),
  include_module_contexts: z.boolean().default(true),
  semantic: z
    .boolean()
    .default(true)
    .describe(
      "Use semantic ranking when a task is provided (requires `haive embeddings index`).",
    ),
  track: z.boolean().default(true).describe("Increment read_count on returned memories"),
};

export type GetBriefingInput = {
  [K in keyof typeof GetBriefingInputSchema]: z.infer<(typeof GetBriefingInputSchema)[K]>;
};

export interface BriefingMemory {
  id: string;
  scope: string;
  type: string;
  module?: string;
  tags: string[];
  status: string;
  confidence: ConfidenceLevel;
  read_count: number;
  reasons: Array<"anchor" | "module" | "domain" | "semantic">;
  semantic_score?: number;
  body: string;
  file_path: string;
}

export interface BriefingOutput {
  task?: string;
  inferred_modules: string[];
  project_context: { content: string; truncated: boolean } | null;
  module_contexts: Array<{ name: string; content: string; truncated: boolean }>;
  memories: BriefingMemory[];
  estimated_tokens: number;
  budget: { max_tokens: number; spent: { project: number; modules: number; memories: number } };
}

export async function getBriefing(
  input: GetBriefingInput,
  ctx: HaiveContext,
): Promise<BriefingOutput> {
  const inferred = inferModulesFromPaths(input.files);
  const memories: BriefingMemory[] = [];

  if (existsSync(ctx.paths.memoriesDir)) {
    const allMemories = await loadMemoriesFromDir(ctx.paths.memoriesDir);
    const usage = await loadUsageIndex(ctx.paths);
    const semanticHits = input.task && input.semantic
      ? await trySemanticHits(ctx, input.task, allMemories.length * 2)
      : null;

    const seen = new Map<string, BriefingMemory>();

    const addOrUpdate = (
      loaded: LoadedMemory,
      reason: BriefingMemory["reasons"][number],
      score?: number,
    ): void => {
      const fm = loaded.memory.frontmatter;
      const existing = seen.get(fm.id);
      if (existing) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        if (score !== undefined && (existing.semantic_score ?? 0) < score) {
          existing.semantic_score = score;
        }
        return;
      }
      const u = getUsage(usage, fm.id);
      seen.set(fm.id, {
        id: fm.id,
        scope: fm.scope,
        type: fm.type,
        ...(fm.module ? { module: fm.module } : {}),
        tags: fm.tags,
        status: fm.status,
        confidence: deriveConfidence(fm, u),
        read_count: u.read_count,
        reasons: [reason],
        ...(score !== undefined ? { semantic_score: score } : {}),
        body: loaded.memory.body,
        file_path: loaded.filePath,
      });
    };

    if (input.files.length > 0) {
      for (const loaded of allMemories) {
        if (memoryMatchesAnchorPaths(loaded.memory, input.files)) addOrUpdate(loaded, "anchor");
      }
      for (const loaded of allMemories) {
        const fm = loaded.memory.frontmatter;
        if (fm.module && inferred.includes(fm.module)) addOrUpdate(loaded, "module");
        if (fm.domain && inferred.includes(fm.domain)) addOrUpdate(loaded, "domain");
        if (fm.tags.some((t) => inferred.includes(t))) addOrUpdate(loaded, "module");
      }
    }

    if (input.task) {
      const tokens = tokenizeQuery(input.task);
      for (const loaded of allMemories) {
        if (literalMatchesAllTokens(loaded.memory, tokens)) {
          addOrUpdate(loaded, "semantic");
        }
      }
      if (semanticHits) {
        const byId = new Map(allMemories.map((m) => [m.memory.frontmatter.id, m]));
        for (const hit of semanticHits) {
          const loaded = byId.get(hit.id);
          if (loaded) addOrUpdate(loaded, "semantic", hit.score);
        }
      }
    }

    const ranked = [...seen.values()].sort((a, b) => {
      const reasonScore = (m: BriefingMemory): number =>
        (m.reasons.includes("anchor") ? 4 : 0) +
        (m.reasons.includes("module") ? 2 : 0) +
        (m.reasons.includes("semantic") ? 2 : 0) +
        (m.reasons.includes("domain") ? 1 : 0);
      const confidenceScore = (m: BriefingMemory): number =>
        m.confidence === "authoritative" ? 4 :
        m.confidence === "trusted" ? 3 :
        m.confidence === "low" ? 1 :
        m.confidence === "stale" ? -2 : 0;
      const sa = reasonScore(a) + confidenceScore(a) + (a.semantic_score ?? 0);
      const sb = reasonScore(b) + confidenceScore(b) + (b.semantic_score ?? 0);
      return sb - sa;
    });

    memories.push(...ranked.slice(0, input.max_memories));

    if (input.track && memories.length > 0) {
      await trackReads(ctx.paths, memories.map((m) => m.id));
    }
  }

  // Build raw section payloads
  const projectContext =
    input.include_project_context && existsSync(ctx.paths.projectContext)
      ? await readFile(ctx.paths.projectContext, "utf8")
      : "";

  const moduleContents = input.include_module_contexts
    ? await loadModuleContexts(ctx, inferred)
    : [];

  const memoriesText = memories
    .map((m) => `### ${m.id} (${m.scope}/${m.type}, ${m.confidence})\n${m.body.trim()}`)
    .join("\n\n---\n\n");

  // Allocate budget across the three large pieces
  const slices = allocateBudget(
    [
      { key: "project", text: projectContext, weight: 3, mode: "head" },
      {
        key: "modules",
        text: moduleContents.map((m) => `## ${m.name}\n${m.content}`).join("\n\n---\n\n"),
        weight: 3,
        mode: "head",
      },
      { key: "memories", text: memoriesText, weight: 4, mode: "head" },
    ],
    input.max_tokens,
  );

  const projectSlice = slices.find((s) => s.key === "project")!;
  const modulesSlice = slices.find((s) => s.key === "modules")!;
  const memoriesSlice = slices.find((s) => s.key === "memories")!;

  const trimmedModules: BriefingOutput["module_contexts"] = [];
  if (modulesSlice.text.length > 0 && moduleContents.length > 0) {
    // Distribute the modules slice across module entries proportionally
    const subSlices = allocateBudget(
      moduleContents.map((m) => ({ key: m.name, text: m.content, weight: 1, mode: "head" as const })),
      modulesSlice.allocatedTokens,
    );
    for (const m of moduleContents) {
      const sub = subSlices.find((s) => s.key === m.name)!;
      trimmedModules.push({ name: m.name, content: sub.text, truncated: sub.truncated });
    }
  }

  const trimmedMemoriesText = memoriesSlice.text;

  // Recompute memory bodies to fit. We slice the joined text but also expose
  // the truncated body per memory so the AI can render either form.
  const trimmedMemories = memories.map((m): BriefingMemory => {
    if (!memoriesSlice.truncated) return m;
    const tokensPer = Math.floor(memoriesSlice.allocatedTokens / Math.max(1, memories.length));
    const t = truncateToTokens(m.body, { maxTokens: tokensPer, mode: "head" });
    return { ...m, body: t.text };
  });

  const totalTokens =
    projectSlice.estimatedTokens + modulesSlice.estimatedTokens + memoriesSlice.estimatedTokens;

  return {
    ...(input.task ? { task: input.task } : {}),
    inferred_modules: inferred,
    project_context: projectContext
      ? { content: projectSlice.text, truncated: projectSlice.truncated }
      : null,
    module_contexts: trimmedModules,
    memories: trimmedMemories,
    estimated_tokens: totalTokens,
    budget: {
      max_tokens: input.max_tokens,
      spent: {
        project: projectSlice.estimatedTokens,
        modules: modulesSlice.estimatedTokens,
        memories: memoriesSlice.estimatedTokens,
      },
    },
  };
}

async function trySemanticHits(
  ctx: HaiveContext,
  task: string,
  limit: number,
): Promise<Array<{ id: string; score: number }> | null> {
  let mod: typeof import("@hiveai/embeddings");
  try {
    mod = await import("@hiveai/embeddings");
  } catch {
    return null;
  }
  const result = await mod.semanticSearch(ctx.paths, task, { limit });
  if (!result) return null;
  return result.hits.map((h) => ({ id: h.id, score: h.score }));
}

async function loadModuleContexts(
  ctx: HaiveContext,
  modules: string[],
): Promise<Array<{ name: string; content: string }>> {
  if (modules.length === 0) return [];
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

// Re-export estimateTokens at the module level for tests.
export { estimateTokens };
