import { existsSync } from "node:fs";
import {
  deriveConfidence,
  getUsage,
  loadMemoriesFromDir,
  loadUsageIndex,
  pathsOverlap,
  tokenizeQuery,
  type LoadedMemory,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemConflictsInputSchema = {
  id: z
    .string()
    .min(1)
    .describe("Memory id to check for conflicts."),
  min_score: z
    .number()
    .min(0)
    .max(1)
    .default(0.5)
    .describe("Minimum cosine similarity to consider a memory as a potential conflict (semantic mode)."),
  semantic: z
    .boolean()
    .default(true)
    .describe("Use embeddings for similarity. Falls back to keyword overlap when embeddings are not installed."),
};

export type MemConflictsInput = {
  [K in keyof typeof MemConflictsInputSchema]: z.infer<(typeof MemConflictsInputSchema)[K]>;
};

export type ConflictReason =
  | "opposite-status"
  | "attempt-vs-convention-same-paths"
  | "polarity-keywords"
  | "explicit-contradiction-tag";

export interface ConflictHit {
  id: string;
  type: string;
  scope: string;
  status: string;
  confidence: string;
  body_preview: string;
  similarity: number | null;
  reasons: ConflictReason[];
  shared_paths: string[];
}

export interface MemConflictsOutput {
  found: boolean;
  target?: { id: string; type: string; status: string };
  scanned: number;
  conflicts: ConflictHit[];
  notice?: string;
}

const POSITIVE_PATTERNS = /\b(use|prefer|always|should use|do this|recommended|ok to)\b/i;
const NEGATIVE_PATTERNS = /\b(do not use|don'?t use|never|avoid|forbidden|deprecated|stop using|do NOT|❌)\b/i;

/**
 * Find memories that potentially CONTRADICT the given memory. Useful before
 * relying on a memory's advice — surfaces "another memory says the opposite".
 *
 * Detection layers (any of these triggers a hit):
 *   - Opposite status: target is validated, neighbor is rejected — for the same topic
 *   - Type mismatch on overlapping paths: an `attempt` (don't do X) coexists with
 *     a `convention` (do X) anchored to overlapping paths
 *   - Polarity keywords: target says "use X" while a semantic neighbor says "don't use X"
 *   - Explicit contradiction tag (#contradicts:<id>) in either body
 */
export async function memConflicts(
  input: MemConflictsInput,
  ctx: HaiveContext,
): Promise<MemConflictsOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { found: false, scanned: 0, conflicts: [], notice: "No .ai/memories directory." };
  }
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const target = all.find(({ memory }) => memory.frontmatter.id === input.id);
  if (!target) {
    return { found: false, scanned: 0, conflicts: [], notice: `Memory '${input.id}' not found.` };
  }

  const usage = await loadUsageIndex(ctx.paths);
  const others = all.filter(({ memory }) =>
    memory.frontmatter.id !== input.id &&
    memory.frontmatter.type !== "session_recap"
  );

  // Optional: get semantic similarity scores via embeddings
  const simScores = input.semantic ? await trySemanticSimilarities(ctx, target, others) : null;

  const targetText = (target.memory.body + " " + target.memory.frontmatter.tags.join(" "))
    .toLowerCase();
  const targetTokens = new Set(tokenizeQuery(targetText));
  const targetPolarity = polarity(targetText);
  const targetPaths = target.memory.frontmatter.anchor.paths;
  const explicitContradicts = extractContradictsTags(target.memory.body);

  const conflicts: ConflictHit[] = [];

  for (const other of others) {
    const fm = other.memory.frontmatter;
    const otherText = (other.memory.body + " " + fm.tags.join(" ")).toLowerCase();
    const reasons: ConflictReason[] = [];

    const sim = simScores?.get(fm.id) ?? null;

    // Pre-filter: at least some keyword or path overlap or semantic hit.
    const hasPathOverlap = fm.anchor.paths.some((p) => targetPaths.some((tp) => pathsOverlap(p, tp)));
    const otherTokens = new Set(tokenizeQuery(otherText));
    const tokenOverlap = countIntersection(targetTokens, otherTokens);
    const isSemanticNeighbor = sim !== null && sim >= input.min_score;
    if (!hasPathOverlap && tokenOverlap < 4 && !isSemanticNeighbor) continue;

    // 1. Explicit contradicts tag
    const otherContradicts = extractContradictsTags(other.memory.body);
    if (explicitContradicts.has(fm.id) || otherContradicts.has(input.id)) {
      reasons.push("explicit-contradiction-tag");
    }

    // 2. Opposite status (one validated, the other rejected on the same topic)
    if (
      target.memory.frontmatter.status === "validated" && fm.status === "rejected" ||
      target.memory.frontmatter.status === "rejected" && fm.status === "validated"
    ) {
      if (tokenOverlap >= 4 || isSemanticNeighbor) reasons.push("opposite-status");
    }

    // 3. attempt vs convention/decision on overlapping paths
    if (hasPathOverlap) {
      const tType = target.memory.frontmatter.type;
      const oType = fm.type;
      const isAttemptVsRule = (tType === "attempt" && (oType === "convention" || oType === "decision")) ||
        (oType === "attempt" && (tType === "convention" || tType === "decision"));
      if (isAttemptVsRule) reasons.push("attempt-vs-convention-same-paths");
    }

    // 4. Polarity inversion on shared keywords
    if (isSemanticNeighbor) {
      const otherPolarity = polarity(otherText);
      if (
        (targetPolarity === "positive" && otherPolarity === "negative") ||
        (targetPolarity === "negative" && otherPolarity === "positive")
      ) {
        reasons.push("polarity-keywords");
      }
    }

    if (reasons.length === 0) continue;

    const u = getUsage(usage, fm.id);
    conflicts.push({
      id: fm.id,
      type: fm.type,
      scope: fm.scope,
      status: fm.status,
      confidence: deriveConfidence(fm, u),
      body_preview: other.memory.body.split("\n").slice(0, 4).join("\n").slice(0, 300),
      similarity: sim,
      reasons,
      shared_paths: fm.anchor.paths.filter((p) => targetPaths.some((tp) => pathsOverlap(p, tp))),
    });
  }

  // Rank: explicit > opposite-status > others; tiebreak by similarity desc
  conflicts.sort((a, b) => {
    const score = (c: ConflictHit): number =>
      (c.reasons.includes("explicit-contradiction-tag") ? 100 : 0) +
      (c.reasons.includes("opposite-status") ? 50 : 0) +
      (c.reasons.includes("attempt-vs-convention-same-paths") ? 25 : 0) +
      (c.reasons.includes("polarity-keywords") ? 10 : 0) +
      (c.similarity ?? 0) * 5;
    return score(b) - score(a);
  });

  return {
    found: true,
    target: {
      id: target.memory.frontmatter.id,
      type: target.memory.frontmatter.type,
      status: target.memory.frontmatter.status,
    },
    scanned: others.length,
    conflicts: conflicts.slice(0, 10),
  };
}

function polarity(text: string): "positive" | "negative" | "neutral" {
  const neg = NEGATIVE_PATTERNS.test(text);
  const pos = POSITIVE_PATTERNS.test(text);
  if (neg && !pos) return "negative";
  if (pos && !neg) return "positive";
  return "neutral";
}

function extractContradictsTags(body: string): Set<string> {
  const out = new Set<string>();
  for (const m of body.matchAll(/#contradicts:([\w-]+)/g)) {
    if (m[1]) out.add(m[1]);
  }
  return out;
}

function countIntersection<T>(a: Set<T>, b: Set<T>): number {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n;
}

async function trySemanticSimilarities(
  ctx: HaiveContext,
  target: LoadedMemory,
  others: LoadedMemory[],
): Promise<Map<string, number> | null> {
  let mod: typeof import("@hiveai/embeddings");
  try {
    mod = await import("@hiveai/embeddings");
  } catch {
    return null;
  }
  const result = await mod.semanticSearch(
    ctx.paths,
    target.memory.body,
    { limit: others.length },
  );
  if (!result) return null;
  const map = new Map<string, number>();
  for (const hit of result.hits) map.set(hit.id, hit.score);
  return map;
}
