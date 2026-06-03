/**
 * Gate signal-quality — is the inferential (anti-pattern) gate earning trust or crying wolf?
 *
 * hAIve's anti-pattern gate is probabilistic and warmup-sensitive, so it is deliberately calibrated
 * NOT to hard-block on weak matches. But a team needs to SEE whether the gate's signal is precise:
 * are its catches turning out to be real (prevented mistakes, applied lessons) or noise (rejected by
 * humans via `mem_feedback`)? This module turns the signals hAIve already records — prevention events
 * (by source) and per-memory rejection counts — into a precision indicator and an actionable tuning
 * suggestion for `enforcement.antiPatternGate`. Pure: no I/O.
 */
import type { PreventionEvent } from "./prevention.js";
import type { UsageIndex } from "./usage.js";
import type { AntiPatternGate } from "./config.js";

export interface GatePrecision {
  /** Catches recorded by deterministic regex/command sensors. */
  sensor_catches: number;
  /** Catches recorded by the inferential anti-pattern gate. */
  anti_pattern_catches: number;
  /** Total "useful" outcomes (catches + human-applied lessons). */
  useful: number;
  /** Total human rejections (mem_feedback "not useful"). Proxy for false positives. */
  rejections: number;
  /** useful / (useful + rejections), 0..1. Null when there is no signal yet. */
  precision: number | null;
  /** A tuning recommendation for enforcement.antiPatternGate, or null when current looks right. */
  suggestion: GateTuningSuggestion | null;
}

export interface GateTuningSuggestion {
  recommended: AntiPatternGate;
  reason: string;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Compute the gate's signal quality from prevention events + usage.
 * @param currentGate the configured antiPatternGate, used to decide whether to suggest a change.
 */
export function computeGatePrecision(
  events: PreventionEvent[],
  usage: UsageIndex,
  currentGate: AntiPatternGate = "anchored",
): GatePrecision {
  let sensorCatches = 0;
  let antiPatternCatches = 0;
  for (const e of events) {
    if (e.source === "sensor") sensorCatches += 1;
    else if (e.source === "anti-pattern") antiPatternCatches += 1;
  }

  let applied = 0;
  let rejections = 0;
  for (const mem of Object.values(usage.by_id ?? {})) {
    applied += mem.applied_count ?? 0;
    rejections += mem.rejected_count ?? 0;
  }

  const useful = sensorCatches + antiPatternCatches + applied;
  const denom = useful + rejections;
  const precision = denom === 0 ? null : round3(useful / denom);

  return {
    sensor_catches: sensorCatches,
    anti_pattern_catches: antiPatternCatches,
    useful,
    rejections,
    precision,
    suggestion: suggestGate(precision, rejections, currentGate),
  };
}

/**
 * Suggest loosening the gate when it is noisy (low precision with real rejection volume), or
 * tightening it when it is precise but currently soft. Returns null when current looks right or
 * there isn't enough signal to act on.
 */
export function suggestGate(
  precision: number | null,
  rejections: number,
  currentGate: AntiPatternGate,
): GateTuningSuggestion | null {
  // Need a meaningful sample before recommending a change.
  if (precision === null || rejections < 3) return null;

  if (precision < 0.5 && (currentGate === "anchored" || currentGate === "strict")) {
    return {
      recommended: "review",
      reason: `Gate precision ${precision} with ${rejections} rejection(s) — the gate is crying wolf. Loosen to "review" (surface, don't hard-block) until the corpus is cleaner.`,
    };
  }
  if (precision >= 0.85 && currentGate === "review") {
    return {
      recommended: "anchored",
      reason: `Gate precision ${precision} — catches are reliably real. Tighten to "anchored" so corroborated anti-patterns hard-block.`,
    };
  }
  return null;
}
