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

export interface AppliedConflictResolution {
  /** Updated frontmatter for the memory to keep (promoted). */
  winner: MemoryFrontmatter;
  /** Updated frontmatter for the memory to supersede (deprecated). */
  loser: MemoryFrontmatter;
  /** Topic the winner now carries — the consolidation target for future `mem_save` upserts. Null when neither carried one. */
  topic: string | null;
  /** True when the winner adopted the loser's topic because it had none. */
  topic_adopted: boolean;
}

/**
 * Turn a {@link ConflictResolution} plan into the two concrete frontmatter updates — the guided
 * supersede the backlog called for, wired into topic-upsert/revision_count:
 *   - loser  → deprecated, stamped with stale_reason + a related_ids link to the winner.
 *   - winner → revision_count++ (it absorbed a contradiction), verified now, linked to the loser,
 *     and it ADOPTS the loser's topic when it had none — so the next `mem_save` on this subject
 *     upserts into the winner instead of spawning a third conflicting memory. An existing winner
 *     topic is never overwritten. Pure: the caller persists both.
 */
export function applyConflictResolution(
  winner: LoadedMemory,
  loser: LoadedMemory,
  plan: ConflictResolution,
  now: Date = new Date(),
): AppliedConflictResolution {
  const ts = now.toISOString();
  const wf = winner.memory.frontmatter;
  const lf = loser.memory.frontmatter;

  const winnerHasTopic = Boolean(wf.topic && wf.topic.trim() !== "");
  const loserHasTopic = Boolean(lf.topic && lf.topic.trim() !== "");
  const topicAdopted = !winnerHasTopic && loserHasTopic;
  const topic = winnerHasTopic ? wf.topic! : topicAdopted ? lf.topic! : null;

  const winnerFm: MemoryFrontmatter = {
    ...wf,
    revision_count: wf.revision_count + 1,
    verified_at: ts,
    related_ids: [...new Set([...wf.related_ids, plan.supersede_id])],
    ...(topic ? { topic } : {}),
  };

  const loserFm: MemoryFrontmatter = {
    ...lf,
    status: "deprecated",
    stale_reason: plan.stale_reason,
    verified_at: ts,
    related_ids: [...new Set([...lf.related_ids, plan.keep_id])],
  };

  return { winner: winnerFm, loser: loserFm, topic, topic_adopted: topicAdopted };
}
