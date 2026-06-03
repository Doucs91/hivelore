/**
 * Contradiction resolution planning — turns "two memories conflict" into "do THIS".
 *
 * `conflict-candidates.ts` surfaces pairs (same topic with opposed status, or lexically near-
 * duplicate). That's detection, not resolution — and Fowler lists incoherence-at-scale (a harness
 * full of contradictory guides) as a core open challenge. This module decides, deterministically,
 * which memory of a pair should WIN and which should be superseded (deprecated), so the CLI can
 * apply it. Pure: no I/O, unit-tested.
 *
 * Decision order (strongest signal first):
 *   1. status     — a `validated` memory beats a `rejected`/`deprecated`/`stale` one.
 *   2. revision   — higher `revision_count` (more refined via topic-upsert) wins.
 *   3. recency    — newer `created_at` wins (the team's latest word).
 */
import type { LoadedMemory } from "./loader.js";
import type { MemoryFrontmatter } from "./types.js";

export interface ConflictResolution {
  /** Memory id to keep authoritative. */
  keep_id: string;
  /** Memory id to deprecate (superseded). */
  supersede_id: string;
  /** Human-readable reason the winner was chosen. */
  reason: string;
  /** stale_reason to stamp on the superseded memory. */
  stale_reason: string;
}

const STATUS_RANK: Record<string, number> = {
  validated: 4,
  proposed: 3,
  draft: 2,
  stale: 1,
  deprecated: 0,
  rejected: 0,
};

function statusRank(fm: MemoryFrontmatter): number {
  return STATUS_RANK[fm.status] ?? 2;
}

/** Compare two memories; returns the one that should WIN plus the reason. Pure. */
export function planConflictResolution(
  a: LoadedMemory,
  b: LoadedMemory,
): ConflictResolution {
  const fa = a.memory.frontmatter;
  const fb = b.memory.frontmatter;

  const ra = statusRank(fa);
  const rb = statusRank(fb);
  let winner: LoadedMemory;
  let loser: LoadedMemory;
  let reason: string;

  if (ra !== rb) {
    [winner, loser] = ra > rb ? [a, b] : [b, a];
    reason = `status (${winner.memory.frontmatter.status} beats ${loser.memory.frontmatter.status})`;
  } else if (fa.revision_count !== fb.revision_count) {
    [winner, loser] = fa.revision_count > fb.revision_count ? [a, b] : [b, a];
    reason = `revision_count (${winner.memory.frontmatter.revision_count} > ${loser.memory.frontmatter.revision_count})`;
  } else {
    const cmp = fa.created_at.localeCompare(fb.created_at);
    [winner, loser] = cmp >= 0 ? [a, b] : [b, a];
    reason = `recency (${winner.memory.frontmatter.created_at} is newer)`;
  }

  const keepId = winner.memory.frontmatter.id;
  const supersedeId = loser.memory.frontmatter.id;
  return {
    keep_id: keepId,
    supersede_id: supersedeId,
    reason,
    stale_reason: `Superseded by ${keepId} (conflict resolved on ${reason}).`,
  };
}
