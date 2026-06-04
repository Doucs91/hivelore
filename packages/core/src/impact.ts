import type { MemoryFrontmatter } from "./types.js";
import type { MemoryUsage } from "./usage.js";

/**
 * Closed-loop memory-utility scoring — the "did this memory actually help?" layer.
 *
 * hAIve already tracks reads ({@link ./usage.js}) and derives a trust level from
 * status + read_count ({@link ./confidence.js}). But a read only means a memory was
 * *surfaced*, not that it *helped* — a memory can be injected on every briefing and
 * silently ignored. Harness engineering's core loop (Fowler / LangChain) is to
 * measure what demonstrably steers work and let that feed back into recall.
 *
 * `computeImpact` combines the signals hAIve already records but never correlated:
 *   POSITIVE  reads · applied outcomes (mem_feedback) · a sensor that actually fired
 *   NEGATIVE  rejections · stale/deprecated/rejected status · dormancy
 * into a single 0..1 utility score, a tier, and a prune-candidate flag. It is a pure
 * function (no I/O), unit-tested in `packages/core/test/impact.test.ts`.
 */

export type ImpactTier = "high" | "medium" | "low" | "dormant";

export interface ImpactScore {
  /** Normalized utility score in [0, 1]. */
  score: number;
  tier: ImpactTier;
  /** Human-readable breakdown of the signals that produced the score. */
  signals: string[];
  /**
   * True when the memory looks like dead weight worth reviewing/pruning:
   * more rejections than reads, or never used with no guardrail, or already
   * stale/deprecated/rejected. A memory carrying a `sensor` or with `applied`
   * outcomes is never a prune candidate — it earns its keep as a guardrail.
   */
  pruneCandidate: boolean;
}

export interface ImpactOptions {
  /** Days with no read AND no applied outcome after which a memory is "dormant". */
  dormantDays?: number;
  now?: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default dormancy window — half the confidence hard-decay (365d), so impact reacts sooner. */
export const DEFAULT_DORMANT_DAYS = 120;

/** Reads needed to saturate the read component of the score. */
const READ_SATURATION = 32;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function hasSensorFired(fm: MemoryFrontmatter): boolean {
  return Boolean(fm.sensor?.last_fired);
}

function isDeadStatus(fm: MemoryFrontmatter): boolean {
  return fm.status === "stale" || fm.status === "deprecated" || fm.status === "rejected";
}

/**
 * Compute the demonstrated utility of a single memory from its frontmatter + usage.
 * Pure and deterministic given `now`.
 */
export function computeImpact(
  fm: MemoryFrontmatter,
  usage: MemoryUsage,
  options: ImpactOptions = {},
): ImpactScore {
  const now = options.now ?? new Date();
  const dormantDays = options.dormantDays ?? DEFAULT_DORMANT_DAYS;
  const signals: string[] = [];

  let raw = 0;

  // POSITIVE — reads (a memory that keeps getting surfaced has some pull). Log-scaled
  // and capped at 0.35 so reads alone can never reach "high": being surfaced is not
  // the same as being useful.
  if (usage.read_count > 0) {
    raw += Math.min(1, Math.log2(usage.read_count + 1) / Math.log2(READ_SATURATION + 1)) * 0.35;
    signals.push(`read ${usage.read_count}×`);
  }

  // POSITIVE — applied outcomes: the strongest signal. The agent/human confirmed it
  // changed what they did. 4 applications saturate this 0.60 component — enough to
  // reach "high" on its own, since a demonstrably-applied memory has earned it.
  if (usage.applied_count > 0) {
    raw += Math.min(1, usage.applied_count / 4) * 0.6;
    signals.push(`applied ${usage.applied_count}×`);
  }

  // POSITIVE — prevention events (OUTCOME): the memory's sensor fired on real diffs, intercepting a
  // documented mistake before it landed. The strongest demonstrated-value signal — 3 catches
  // saturate this 0.60 component (enough to reach "high" alone, like applied). Falls back to the
  // frontmatter `sensor.last_fired` flag for memories that fired before prevention counting existed.
  if (usage.prevented_count > 0) {
    raw += Math.min(1, usage.prevented_count / 3) * 0.6;
    signals.push(`prevented ${usage.prevented_count}×`);
  } else if (hasSensorFired(fm)) {
    raw += 0.25;
    signals.push("sensor fired");
  }

  // NEGATIVE — rejections: explicit "not useful" feedback. Heavily weighted.
  if (usage.rejected_count > 0) {
    raw -= Math.min(0.6, usage.rejected_count * 0.25);
    signals.push(`rejected ${usage.rejected_count}×`);
  }

  let score = clamp01(raw);

  // Dead statuses collapse the score regardless of past reads.
  if (isDeadStatus(fm)) {
    score *= 0.2;
    signals.push(`status=${fm.status}`);
  }

  // Dormancy — no read and no application within the window. The clock starts at the
  // most recent activity (applied → read → created).
  const anchor = usage.last_applied_at ?? usage.last_read_at ?? fm.created_at;
  const ageDays = (now.getTime() - new Date(anchor).getTime()) / MS_PER_DAY;
  const dormant =
    Number.isFinite(ageDays) && ageDays >= dormantDays && usage.applied_count === 0;
  if (dormant) {
    score *= 0.5;
    signals.push(`dormant ${Math.floor(ageDays)}d`);
  }

  const tier = deriveTier(score, dormant, usage);
  const pruneCandidate = isPruneCandidate(fm, usage, tier);

  return { score: round3(score), tier, signals, pruneCandidate };
}

function deriveTier(score: number, dormant: boolean, usage: MemoryUsage): ImpactTier {
  if (dormant && usage.read_count <= 1 && usage.applied_count === 0) return "dormant";
  if (score >= 0.55) return "high";
  if (score >= 0.2) return "medium";
  return "low";
}

function isPruneCandidate(
  fm: MemoryFrontmatter,
  usage: MemoryUsage,
  tier: ImpactTier,
): boolean {
  // A sensor or any applied outcome means the memory earns its keep.
  if (fm.sensor || usage.applied_count > 0) return false;
  if (isDeadStatus(fm)) return true;
  // More rejected than read = actively unhelpful.
  if (usage.rejected_count > 0 && usage.rejected_count >= usage.read_count) return true;
  // Never used and gone dormant = dead weight.
  if (tier === "dormant" && usage.read_count === 0) return true;
  return false;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Sort comparator: highest impact first, prune candidates last on ties. */
export function compareImpact(a: ImpactScore, b: ImpactScore): number {
  if (b.score !== a.score) return b.score - a.score;
  if (a.pruneCandidate !== b.pruneCandidate) return a.pruneCandidate ? 1 : -1;
  return 0;
}

export interface ImpactSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
  dormant: number;
  prune_candidates: number;
}

/** Roll up a set of impact scores into tier counts. */
export function summarizeImpact(scores: ImpactScore[]): ImpactSummary {
  const summary: ImpactSummary = {
    total: scores.length,
    high: 0,
    medium: 0,
    low: 0,
    dormant: 0,
    prune_candidates: 0,
  };
  for (const s of scores) {
    summary[s.tier] += 1;
    if (s.pruneCandidate) summary.prune_candidates += 1;
  }
  return summary;
}

export type FeedbackAdjustmentAction = "none" | "downgrade-block-sensor" | "deprecate-memory";

export interface FeedbackAdjustment {
  action: FeedbackAdjustmentAction;
  reason: string;
}

export interface FeedbackAdjustmentOptions {
  /** Rejections needed before deprecating a memory with no positive outcomes. Defaults to 2. */
  rejectionThreshold?: number;
}

/**
 * Turn explicit human rejection (`mem_feedback outcome=rejected`) into a deterministic
 * noise-reduction action. Pure: callers decide whether to persist the returned change.
 */
export function recommendFeedbackAdjustment(
  fm: MemoryFrontmatter,
  usage: MemoryUsage,
  options: FeedbackAdjustmentOptions = {},
): FeedbackAdjustment {
  const rejectionThreshold = options.rejectionThreshold ?? 2;
  const hasPositiveOutcome = usage.applied_count > 0 || usage.prevented_count > 0;

  if (fm.sensor?.severity === "block" && usage.rejected_count >= 1) {
    return {
      action: "downgrade-block-sensor",
      reason: "A human contested a blocking guardrail; downgrade it to warn so the gate stays helpful while the lesson is reviewed.",
    };
  }

  if (!hasPositiveOutcome && usage.rejected_count >= rejectionThreshold) {
    return {
      action: "deprecate-memory",
      reason: `${usage.rejected_count} rejection(s) and no applied/prevented outcomes; deprecate until the lesson is refined.`,
    };
  }

  return { action: "none", reason: "No automatic adjustment needed." };
}

export function applyFeedbackAdjustment(
  fm: MemoryFrontmatter,
  adjustment: FeedbackAdjustment,
  now: Date = new Date(),
): MemoryFrontmatter {
  if (adjustment.action === "none") return fm;
  const tags = [...new Set([...fm.tags, "feedback-contested"])];
  if (adjustment.action === "downgrade-block-sensor" && fm.sensor) {
    return {
      ...fm,
      tags,
      verified_at: now.toISOString(),
      sensor: { ...fm.sensor, severity: "warn" },
    };
  }
  if (adjustment.action === "deprecate-memory") {
    return {
      ...fm,
      tags,
      status: "deprecated",
      stale_reason: adjustment.reason,
      verified_at: now.toISOString(),
    };
  }
  return fm;
}
