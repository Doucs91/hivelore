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
  /** Days without verification after which confidence drops one tier (authoritative → trusted). */
  decayDays: number;
  /** Days without verification after which confidence drops two tiers (e.g. authoritative → low). */
  hardDecayDays: number;
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  trustedReads: 3,
  authoritativeReads: 10,
  decayDays: 180,
  hardDecayDays: 365,
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Confidence comes from validation and explicit evidence, never from repeated exposure.
 * Freshness uses the last verification (or creation), not the last retrieval.
 * Legacy read thresholds remain accepted for API compatibility but have no effect on truth.
 */
export function deriveConfidence(
  fm: MemoryFrontmatter,
  usage: MemoryUsage,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
  now: Date = new Date(),
): ConfidenceLevel {
  if (fm.status === "stale" || fm.status === "deprecated" || fm.status === "rejected") return "stale";

  const baseLevel = baseConfidence(fm);

  // Apply decay only to tiers worth lowering.
  if (baseLevel !== "authoritative" && baseLevel !== "trusted") return baseLevel;

  // Seeing a claim again does not make it newer or more correct.
  const anchor = fm.verified_at ?? fm.created_at;
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
): ConfidenceLevel {
  if (fm.evidence === "hypothesis") return "low";
  if (fm.status === "validated") {
    // Admission is not proof. Authority needs explicit human review AND a tested claim.
    if (fm.validated_by === "human" && fm.evidence === "tested" && fm.verified_at) return "authoritative";
    // A validation that never fails is not a validation: in autopilot, `validated_by: auto` means
    // "has existed for three days", and 150 of 168 team memories in one repo carried `trusted` on
    // that basis alone (field report #12 §1.2, §4.5). Unreviewed content is labelled `low` unless
    // its claim was reproduced or tested; a human or agent review keeps `trusted`.
    if (fm.validated_by === "auto" && fm.evidence !== "reproduced" && fm.evidence !== "tested") return "low";
    return "trusted";
  }
  if (fm.status === "proposed") return "low";
  // draft
  return "unverified";
}

export interface AutoPromoteRule {
  /** Minimum confirmed applications to promote proposed → validated (legacy option name). */
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
  if (fm.status !== "proposed" || fm.evidence === "hypothesis" || fm.requires_human_approval ||
      fm.lifecycle === "planned" || fm.lifecycle === "abandoned") return false;
  if (usage.rejected_count > rule.maxRejections) return false;
  // Keep the public threshold for compatibility, but require confirmed use, not exposure.
  return usage.applied_count >= rule.minReads;
}
