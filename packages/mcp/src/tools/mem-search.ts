import { existsSync } from "node:fs";
import { loadMemoriesFromDir, type LoadedMemory } from "@haive/core";
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
  semantic: z
    .boolean()
    .default(false)
    .describe(
      "Use semantic similarity from the embeddings index (requires `haive embeddings index`).",
    ),
  min_score: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe("Minimum cosine similarity (semantic mode only)"),
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
  score?: number;
}

export interface MemSearchOutput {
  matches: MemSearchHit[];
  total: number;
  mode: "literal" | "semantic" | "literal_fallback";
  notice?: string;
}

export async function memSearch(
  input: MemSearchInput,
  ctx: HaiveContext,
): Promise<MemSearchOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { matches: [], total: 0, mode: input.semantic ? "literal_fallback" : "literal" };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const filtered = all.filter(({ memory }) => passesFilters(memory.frontmatter, input));

  if (input.semantic) {
    const semantic = await trySemanticSearch(ctx, input, filtered);
    if (semantic) return semantic;
    // fall through to literal as a graceful fallback
    return {
      ...buildLiteralResult(input, filtered),
      mode: "literal_fallback",
      notice:
        "Semantic search unavailable (embeddings index missing or @haive/embeddings not installed). Falling back to literal search.",
    };
  }

  return buildLiteralResult(input, filtered);
}

function passesFilters(
  fm: LoadedMemory["memory"]["frontmatter"],
  input: MemSearchInput,
): boolean {
  if (input.scope && fm.scope !== input.scope) return false;
  if (input.type && fm.type !== input.type) return false;
  if (input.module && fm.module !== input.module) return false;
  return true;
}

function buildLiteralResult(
  input: MemSearchInput,
  filtered: LoadedMemory[],
): { matches: MemSearchHit[]; total: number; mode: "literal" } {
  const needle = input.query.toLowerCase();
  const matched = filtered.filter(({ memory }) => {
    const fm = memory.frontmatter;
    if (fm.id.toLowerCase().includes(needle)) return true;
    if (fm.tags.some((t) => t.toLowerCase().includes(needle))) return true;
    if (memory.body.toLowerCase().includes(needle)) return true;
    return false;
  });
  const top = matched.slice(0, input.limit);
  return {
    matches: top.map((loaded) => toHit(loaded, needle)),
    total: matched.length,
    mode: "literal",
  };
}

async function trySemanticSearch(
  ctx: HaiveContext,
  input: MemSearchInput,
  filtered: LoadedMemory[],
): Promise<MemSearchOutput | null> {
  let mod: typeof import("@haive/embeddings");
  try {
    mod = await import("@haive/embeddings");
  } catch {
    return null;
  }
  const result = await mod.semanticSearch(ctx.paths, input.query, {
    limit: Math.min(input.limit * 3, 100),
    minScore: input.min_score,
  });
  if (!result) return null;

  const allowedIds = new Set(filtered.map((m) => m.memory.frontmatter.id));
  const byId = new Map(filtered.map((m) => [m.memory.frontmatter.id, m]));

  const ranked = result.hits
    .filter((h) => allowedIds.has(h.id))
    .slice(0, input.limit);

  const matches: MemSearchHit[] = ranked.map((hit) => {
    const loaded = byId.get(hit.id);
    if (!loaded) {
      return {
        id: hit.id,
        scope: "unknown",
        type: "unknown",
        tags: [],
        status: "unknown",
        snippet: "",
        file_path: hit.file_path,
        score: hit.score,
      };
    }
    const base = toHit(loaded, input.query.toLowerCase());
    return { ...base, score: hit.score };
  });

  return {
    matches,
    total: ranked.length,
    mode: "semantic",
  };
}

function toHit(loaded: LoadedMemory, needle: string): MemSearchHit {
  const fm = loaded.memory.frontmatter;
  return {
    id: fm.id,
    scope: fm.scope,
    type: fm.type,
    ...(fm.module ? { module: fm.module } : {}),
    tags: fm.tags,
    status: fm.status,
    snippet: extractSnippet(loaded.memory.body, needle),
    file_path: loaded.filePath,
  };
}

function extractSnippet(body: string, needle: string): string {
  const lower = body.toLowerCase();
  const idx = needle ? lower.indexOf(needle) : -1;
  if (idx < 0) return body.slice(0, 120).replace(/\s+/g, " ").trim();
  const start = Math.max(0, idx - 40);
  const end = Math.min(body.length, idx + needle.length + 40);
  const snippet = body.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + snippet + (end < body.length ? "…" : "");
}
