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
}

export const DEFAULT_CONFIDENCE_THRESHOLDS: ConfidenceThresholds = {
  trustedReads: 3,
  authoritativeReads: 10,
};

export function deriveConfidence(
  fm: MemoryFrontmatter,
  usage: MemoryUsage,
  thresholds: ConfidenceThresholds = DEFAULT_CONFIDENCE_THRESHOLDS,
): ConfidenceLevel {
  if (fm.status === "stale" || fm.status === "deprecated") return "stale";
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
