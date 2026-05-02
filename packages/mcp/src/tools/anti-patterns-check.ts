import { existsSync } from "node:fs";
import {
  deriveConfidence,
  getUsage,
  loadMemoriesFromDir,
  loadUsageIndex,
  literalMatchesAnyToken,
  memoryMatchesAnchorPaths,
  tokenizeQuery,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const AntiPatternsCheckInputSchema = {
  diff: z
    .string()
    .optional()
    .describe(
      "Raw unified diff text (or any code/text snippet) to scan for previously documented anti-patterns. " +
      "Tokens from the diff are used to match memory bodies and the embeddings index.",
    ),
  paths: z
    .array(z.string())
    .default([])
    .describe(
      "File paths affected by the change. Memories anchored to any of these paths are surfaced regardless of the diff content.",
    ),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(8)
    .describe("Cap on returned warnings."),
  semantic: z
    .boolean()
    .default(true)
    .describe(
      "When true, also use semantic search (requires @hiveai/embeddings + memory index) to find related anti-patterns.",
    ),
};

export type AntiPatternsCheckInput = {
  [K in keyof typeof AntiPatternsCheckInputSchema]: z.infer<(typeof AntiPatternsCheckInputSchema)[K]>;
};

export interface AntiPatternsWarning {
  id: string;
  type: "attempt" | "gotcha";
  scope: string;
  confidence: string;
  body_preview: string;
  reasons: Array<"anchor" | "literal" | "semantic">;
  semantic_score?: number;
}

export interface AntiPatternsCheckOutput {
  /** Total number of attempt+gotcha memories that exist in this project. */
  scanned: number;
  warnings: AntiPatternsWarning[];
  notice?: string;
}

/**
 * Scan a diff (or set of paths) against documented attempt/gotcha memories.
 * Surfaces "you are about to repeat a known mistake" warnings BEFORE you commit.
 *
 * Matching strategy:
 *   1. Anchor — memories anchored to any of the changed paths
 *   2. Literal — tokens from the diff overlap with memory body
 *   3. Semantic — cosine similarity (when enabled and index available)
 */
export async function antiPatternsCheck(
  input: AntiPatternsCheckInput,
  ctx: HaiveContext,
): Promise<AntiPatternsCheckOutput> {
  if (!input.diff && input.paths.length === 0) {
    return {
      scanned: 0,
      warnings: [],
      notice: "Nothing to check — provide either `diff` text or `paths`.",
    };
  }
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { scanned: 0, warnings: [], notice: "No .ai/memories directory — nothing to check against." };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const negative = all.filter(({ memory }) => {
    const t = memory.frontmatter.type;
    if (t !== "attempt" && t !== "gotcha") return false;
    const s = memory.frontmatter.status;
    return s !== "rejected" && s !== "deprecated" && s !== "stale";
  });

  if (negative.length === 0) {
    return { scanned: 0, warnings: [], notice: "No attempt/gotcha memories found yet." };
  }

  const usage = await loadUsageIndex(ctx.paths);
  const seen = new Map<string, AntiPatternsWarning>();

  const upsert = (
    fm: { id: string; type: string; scope: string },
    body: string,
    reason: AntiPatternsWarning["reasons"][number],
    score?: number,
  ): void => {
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
      type: fm.type as "attempt" | "gotcha",
      scope: fm.scope,
      confidence: deriveConfidence(fm as Parameters<typeof deriveConfidence>[0], u),
      body_preview: body.split("\n").slice(0, 5).join("\n").slice(0, 400),
      reasons: [reason],
      ...(score !== undefined ? { semantic_score: score } : {}),
    });
  };

  // 1. Anchor matches
  if (input.paths.length > 0) {
    for (const { memory } of negative) {
      if (memoryMatchesAnchorPaths(memory, input.paths)) {
        upsert(memory.frontmatter, memory.body, "anchor");
      }
    }
  }

  // 2. Literal token overlap from diff
  if (input.diff) {
    const tokens = tokenizeQuery(input.diff);
    if (tokens.length > 0) {
      for (const { memory } of negative) {
        if (literalMatchesAnyToken(memory, tokens)) {
          upsert(memory.frontmatter, memory.body, "literal");
        }
      }
    }
  }

  // 3. Semantic search
  if (input.semantic && input.diff) {
    try {
      const mod = await import("@hiveai/embeddings");
      const result = await mod.semanticSearch(ctx.paths, input.diff, { limit: input.limit * 2 });
      if (result) {
        const negativeIds = new Set(negative.map(({ memory }) => memory.frontmatter.id));
        for (const hit of result.hits) {
          if (!negativeIds.has(hit.id)) continue;
          const found = negative.find(({ memory }) => memory.frontmatter.id === hit.id);
          if (found) upsert(found.memory.frontmatter, found.memory.body, "semantic", hit.score);
        }
      }
    } catch {
      // embeddings not installed — silently skip semantic
    }
  }

  // Rank: anchor > literal > semantic, then by confidence
  const warnings = [...seen.values()]
    .sort((a, b) => {
      const score = (w: AntiPatternsWarning): number => {
        const reasonW =
          (w.reasons.includes("anchor") ? 4 : 0) +
          (w.reasons.includes("literal") ? 2 : 0) +
          (w.reasons.includes("semantic") ? 1 : 0);
        const confW =
          w.confidence === "authoritative" ? 3 :
          w.confidence === "trusted" ? 2 :
          w.confidence === "low" ? 1 : 0;
        return reasonW + confW + (w.semantic_score ?? 0);
      };
      return score(b) - score(a);
    })
    .slice(0, input.limit);

  return {
    scanned: negative.length,
    warnings,
  };
}
