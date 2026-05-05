import { existsSync } from "node:fs";
import { findLexicalConflictPairs, loadMemoriesFromDir } from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemConflictCandidatesInputSchema = {
  since_days: z
    .number()
    .int()
    .positive()
    .max(3650)
    .default(365)
    .describe("Only memories created since N days ago"),
  types: z
    .array(z.enum(["decision", "architecture", "convention", "gotcha"]))
    .default(["decision", "architecture"])
    .describe("Memory types scanned for pairwise lexical overlap"),
  min_jaccard: z
    .number()
    .min(0)
    .max(1)
    .default(0.45)
    .describe("Minimum Jaccard token similarity to surface as a candidate pair"),
  max_pairs: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe("Cap pairs returned"),
  max_scan: z
    .number()
    .int()
    .positive()
    .max(2000)
    .default(500)
    .describe("Maximum memories sampled for O(n²) scan — excess dropped after chronological sort."),
};

export type MemConflictCandidatesInput = {
  [K in keyof typeof MemConflictCandidatesInputSchema]: z.infer<
    (typeof MemConflictCandidatesInputSchema)[K]
  >;
};

export async function memConflictCandidates(
  input: MemConflictCandidatesInput,
  ctx: HaiveContext,
) {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return {
      pairs: [],
      scanned: 0,
      truncated: false,
      notice: "No .ai/memories directory.",
    };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const { pairs, scanned, truncated } = findLexicalConflictPairs(all, {
    sinceDays: input.since_days,
    types: input.types,
    minJaccard: input.min_jaccard,
    maxPairs: input.max_pairs,
    maxScan: input.max_scan,
  });

  const notice =
    pairs.length === 0
      ? "No lexical candidate pairs ≥ threshold — try lowering min_jaccard or widen since_days/types."
      : undefined;

  return { pairs, scanned, truncated, notice };
}
