import { existsSync } from "node:fs";
import {
  findLexicalConflictPairs,
  findTopicStatusConflictPairs,
  loadMemoriesFromDir,
  planConflictResolution,
  type LoadedMemory,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

interface SuggestedResolution {
  keep_id: string;
  supersede_id: string;
  reason: string;
  /** Copy-paste command that APPLIES the guided supersede (promotes winner, deprecates loser). */
  command: string;
}

/**
 * Turn a detected pair into a guided action: which memory wins, which is superseded, and the exact
 * command to apply it. Detection without a recommended next step is just noise the team ignores.
 */
function suggestResolution(
  byId: Map<string, LoadedMemory>,
  idA: string,
  idB: string,
): SuggestedResolution | null {
  const a = byId.get(idA);
  const b = byId.get(idB);
  if (!a || !b) return null;
  const plan = planConflictResolution(a, b);
  return {
    keep_id: plan.keep_id,
    supersede_id: plan.supersede_id,
    reason: plan.reason,
    command: `hivelore memory resolve-conflict ${plan.keep_id} ${plan.supersede_id} --yes`,
  };
}

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
  max_topic_pairs: z
    .number()
    .int()
    .positive()
    .max(100)
    .default(20)
    .describe(
      "Cap for extra signal: memories sharing the same topic with validated vs rejected status.",
    ),
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
      topic_status_pairs: [],
      scanned: 0,
      truncated: false,
      notice: "No .ai/memories directory.",
    };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const byId = new Map<string, LoadedMemory>(all.map((m) => [m.memory.frontmatter.id, m]));
  const { pairs, scanned, truncated } = findLexicalConflictPairs(all, {
    sinceDays: input.since_days,
    types: input.types,
    minJaccard: input.min_jaccard,
    maxPairs: input.max_pairs,
    maxScan: input.max_scan,
  });
  const topicStatusPairs = findTopicStatusConflictPairs(all, input.max_topic_pairs);

  // Guided supersede: attach the deterministic winner/loser + apply command to every pair.
  const enrichedPairs = pairs.map((p) => ({
    ...p,
    suggested_resolution: suggestResolution(byId, p.id_a, p.id_b),
  }));
  const enrichedTopicStatusPairs = topicStatusPairs.map((p) => ({
    ...p,
    suggested_resolution: suggestResolution(byId, p.id_a, p.id_b),
  }));

  const notice =
    pairs.length === 0 && topicStatusPairs.length === 0
      ? "No lexical or topic-status candidates — widen since_days/types or lower min_jaccard."
      : undefined;

  return {
    pairs: enrichedPairs,
    topic_status_pairs: enrichedTopicStatusPairs,
    scanned,
    truncated,
    notice,
  };
}
