import { existsSync } from "node:fs";
import {
  addedLinesFromDiff,
  deriveConfidence,
  getUsage,
  isRetiredMemory,
  loadMemoriesFromDir,
  loadUsageIndex,
  literalMatchesAnyToken,
  memoryMatchesAnchorPaths,
  runRegexSensor,
  sensorAppliesToPath,
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
  min_semantic_score: z
    .number()
    .min(0)
    .max(1)
    .default(0.45)
    .describe(
      "Minimum cosine score for semantic-only anti-pattern hits. Anchor/literal matches still surface. " +
      "Default 0.45 keeps broad, weakly-related memories out of review noise.",
    ),
};

export interface AntiPatternsCheckInput {
  diff?: string;
  paths: string[];
  limit: number;
  semantic: boolean;
  min_semantic_score?: number;
}

export interface AntiPatternsWarning {
  id: string;
  type: "attempt" | "gotcha";
  scope: string;
  confidence: string;
  body_preview: string;
  reasons: Array<"anchor" | "literal" | "semantic" | "sensor">;
  semantic_score?: number;
  /** When a regex sensor fired: its self-correction message and severity. */
  sensor_message?: string;
  sensor_severity?: "warn" | "block";
  /** Memory tags — used downstream (e.g. pre_commit_check) to weight a warning by topic. */
  tags?: string[];
  /** Anchor paths of the memory — lets the gate tell what kind of file this warning is about. */
  anchor_paths?: string[];
}

export interface AntiPatternsCheckOutput {
  /** Total number of attempt+gotcha memories that exist in this project. */
  scanned: number;
  warnings: AntiPatternsWarning[];
  notice?: string;
}

/**
 * Common code tokens that would match almost any memory body and create literal noise.
 * Excluded from diff literal-matching so the "literal" reason stays a meaningful signal.
 */
const CODE_STOPWORDS = new Set([
  "import", "export", "function", "return", "const", "let", "var", "class", "public",
  "private", "protected", "static", "this", "true", "false", "null", "undefined", "void",
  "async", "await", "from", "type", "interface", "extends", "implements", "number", "string",
  "boolean", "value", "default", "case", "break", "continue", "throw", "catch", "finally",
  "else", "while", "for", "new", "super", "yield", "module", "require", "console",
]);

/**
 * Tokenize a diff for LITERAL anti-pattern matching.
 *
 * `tokenizeQuery` splits on whitespace only, so code without spaces around an identifier
 * (e.g. `Number(BigInt(a))`) collapses into one un-matchable blob and the "literal" signal
 * silently disappears — leaving the gate to lean on the (non-deterministic, warmup-sensitive)
 * semantic score. We additionally split on non-word boundaries and keep identifier-length
 * tokens (>= 4 chars, not a ubiquitous keyword) so `BigInt`, `lodash`, `openInView`, etc. are
 * matched reliably. The set is unioned with the whitespace tokens to preserve existing behavior.
 */
function tokenizeDiffForLiteral(diff: string): string[] {
  // If this is a unified diff, only consider ADDED lines. The gate should fire on
  // "you introduced the bad pattern", not "you touched a file that merely mentions it"
  // (or "you REMOVED it"). This cuts false positives on refactors that edit anchored files.
  const lines = diff.split("\n");
  const looksLikeDiff = lines.some((l) => /^[+-]/.test(l));
  const addedOnly = looksLikeDiff
    ? lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n")
    : diff;
  const source = addedOnly.trim().length > 0 ? addedOnly : diff;

  const wsTokens = tokenizeQuery(source);
  const wordTokens = source
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !CODE_STOPWORDS.has(t));
  return [...new Set([...wsTokens, ...wordTokens])];
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
  const minSemanticScore = input.min_semantic_score ?? 0.45;
  const negative = all.filter(({ memory }) => {
    const t = memory.frontmatter.type;
    if (t !== "attempt" && t !== "gotcha") return false;
    const s = memory.frontmatter.status;
    return s !== "rejected" && s !== "deprecated" && s !== "stale" &&
      !isRetiredMemory(memory.frontmatter, memory.body);
  });

  if (negative.length === 0) {
    return { scanned: 0, warnings: [], notice: "No attempt/gotcha memories found yet." };
  }

  const usage = await loadUsageIndex(ctx.paths);
  const seen = new Map<string, AntiPatternsWarning>();

  const upsert = (
    fm: { id: string; type: string; scope: string; tags?: string[]; anchor?: { paths?: string[] } },
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
      tags: fm.tags ?? [],
      anchor_paths: fm.anchor?.paths ?? [],
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
    const tokens = tokenizeDiffForLiteral(input.diff);
    if (tokens.length > 0) {
      for (const { memory } of negative) {
        if (literalMatchesAnyToken(memory, tokens)) {
          upsert(memory.frontmatter, memory.body, "literal");
        }
      }
    }
  }

  // 2b. Sensor matches — deterministic regex checks derived from memories.
  // A sensor fires on the ADDED lines of the diff ("you introduced the bad pattern").
  // This is the feedback *computational* signal: same result every time, no warmup.
  if (input.diff) {
    const added = addedLinesFromDiff(input.diff);
    const scanText = added.trim().length > 0 ? added : input.diff;
    for (const { memory } of negative) {
      const sensor = memory.frontmatter.sensor;
      if (!sensor || sensor.kind !== "regex") continue;
      const anchorPaths = memory.frontmatter.anchor.paths;
      // When paths are provided, respect the sensor's path scope; otherwise scan globally.
      const inScope =
        input.paths.length === 0 ||
        input.paths.some((p) => sensorAppliesToPath(sensor, anchorPaths, p));
      if (!inScope) continue;
      const hit = runRegexSensor(memory.frontmatter.id, sensor, {
        path: input.paths[0] ?? "",
        content: scanText,
      });
      if (hit) {
        upsert(memory.frontmatter, memory.body, "sensor");
        const w = seen.get(memory.frontmatter.id);
        if (w) {
          w.sensor_message = hit.message;
          w.sensor_severity = hit.severity;
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
          if (hit.score < minSemanticScore && !seen.has(hit.id)) continue;
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
          (w.reasons.includes("sensor") ? 8 : 0) +
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
