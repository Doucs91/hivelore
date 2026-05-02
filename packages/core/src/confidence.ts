import type { MemoryFrontmatter } from "./types.js";
import type { MemoryUsage } from "./usage.js";

export type ConfidenceLevel =
  | "unverified"
  | "low"
  | "trusted"
  | "authoritative"
  | "stale";

export interface ConfidenceThresholds {
  trustedReads: number;
  authoritativeReads: number;
  /** Days without a read after which confidence drops one tier (authoritative → trusted). */
  decayDays: number;
  /** Days without a read after which confidence drops two tiers (e.g. authoritative → low). */
  hardDecayDays: number;
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  trustedReads: 3,
  authoritativeReads: 10,
  decayDays: 180,
  hardDecayDays: 365,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Compute the trust level of a memory.
 *
 * Base tier is derived from `status + read_count`:
 *   - draft → unverified
 *   - proposed (low reads) → low
 *   - proposed (3+ reads) → trusted
 *   - validated (low reads) → trusted
 *   - validated (10+ reads) → authoritative
 *   - stale / deprecated / rejected → stale
 *
 * On top of the base tier, a TIME DECAY is applied: a memory that has not been
 * read in `decayDays` (default 180) drops one tier, and one not read in
 * `hardDecayDays` (default 365) drops two tiers. The clock starts at
 * `last_read_at` if any, otherwise `created_at` from the frontmatter.
 *
 * The decay never crosses into `stale` (we keep that signal reserved for the
 * verifier). The intent is to surface "this used to be authoritative but
 * nobody has touched it in a year — verify before quoting it" without
 * pretending the memory is wrong.
 */
export function deriveConfidence(
  fm: MemoryFrontmatter,
  usage: MemoryUsage,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
  now: Date = new Date(),
): ConfidenceLevel {
  if (fm.status === "stale" || fm.status === "deprecated" || fm.status === "rejected") return "stale";

  const baseLevel = baseConfidence(fm, usage, thresholds);

  // Apply decay only to tiers worth lowering.
  if (baseLevel !== "authoritative" && baseLevel !== "trusted") return baseLevel;

  const anchor = usage.last_read_at ?? fm.created_at;
  const ageDays = (now.getTime() - new Date(anchor).getTime()) / MS_PER_DAY;
  if (Number.isNaN(ageDays) || ageDays <= 0) return baseLevel;

  if (ageDays >= thresholds.hardDecayDays) {
    // Two-tier drop. authoritative → low, trusted → low.
    return "low";
  }
  if (ageDays >= thresholds.decayDays) {
    if (baseLevel === "authoritative") return "trusted";
    if (baseLevel === "trusted") return "low";
  }
  return baseLevel;
}

function baseConfidence(
  fm: MemoryFrontmatter,
  usage: MemoryUsage,
  thresholds: ConfidenceThresholds,
): ConfidenceLevel {
  if (fm.status === "validated") {
    return usage.read_count >= thresholds.authoritativeReads
      ? "authoritative"
      : "trusted";
  }
  if (fm.status === "proposed") {
    return usage.read_count >= thresholds.trustedReads ? "trusted" : "low";
  }
  // draft
  return "unverified";
}

export interface AutoPromoteRule {
  /** Minimum read_count to promote proposed → validated. */
  minReads: number;
  /** Maximum rejected_count tolerated (memories with more rejections never auto-promote). */
  maxRejections: number;
}

export const DEFAULT_AUTO_PROMOTE_RULE: AutoPromoteRule = {
  minReads: 5,
  maxRejections: 0,
};

export function isAutoPromoteEligible(
  fm: MemoryFrontmatter,
  usage: MemoryUsage,
  rule: AutoPromoteRule = DEFAULT_AUTO_PROMOTE_RULE,
): boolean {
  if (fm.status !== "proposed") return false;
  if (usage.rejected_count > rule.maxRejections) return false;
  return usage.read_count >= rule.minReads;
}
