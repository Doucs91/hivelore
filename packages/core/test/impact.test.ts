import { describe, expect, it } from "vitest";
import {
  compareImpact,
  computeImpact,
  applyFeedbackAdjustment,
  recommendFeedbackAdjustment,
  summarizeImpact,
  DEFAULT_DORMANT_DAYS,
} from "../src/impact.js";
import {
  emptyUsage,
  getUsage,
  recordApplied,
  recordPrevention,
  recordRejection,
  PREVENTION_DEBOUNCE_MS,
  type MemoryUsage,
} from "../src/usage.js";
import type { MemoryFrontmatter } from "../src/types.js";

const NOW = new Date("2026-06-01T00:00:00.000Z");

function fm(overrides: Partial<MemoryFrontmatter> = {}): MemoryFrontmatter {
  return {
    id: "2026-01-01-gotcha-x",
    scope: "team",
    type: "gotcha",
    status: "validated",
    anchor: { paths: [], symbols: [] },
    tags: [],
    created_at: "2026-05-25T00:00:00.000Z",
    expires_when: null,
    verified_at: null,
    stale_reason: null,
    related_ids: [],
    last_read_at: null,
    revision_count: 0,
    requires_human_approval: false,
    ...overrides,
  } as MemoryFrontmatter;
}

function usage(overrides: Partial<MemoryUsage> = {}): MemoryUsage {
  return { ...emptyUsage(), ...overrides };
}

const recent = new Date(NOW.getTime() - 2 * 86_400_000).toISOString();
const old = new Date(NOW.getTime() - (DEFAULT_DORMANT_DAYS + 10) * 86_400_000).toISOString();

describe("computeImpact", () => {
  it("scores a fresh, never-touched memory as low (not dormant within window)", () => {
    const r = computeImpact(fm(), usage(), { now: NOW });
    expect(r.tier).toBe("low");
    expect(r.score).toBe(0);
  });

  it("applied outcomes outweigh reads and reach high tier", () => {
    const r = computeImpact(
      fm(),
      usage({ read_count: 3, last_read_at: recent, applied_count: 4, last_applied_at: recent }),
      { now: NOW },
    );
    expect(r.tier).toBe("high");
    expect(r.score).toBeGreaterThanOrEqual(0.6);
    expect(r.signals.join(" ")).toContain("applied 4×");
  });

  it("a fired sensor is a strong positive signal", () => {
    const withSensor = fm({
      sensor: {
        kind: "regex",
        pattern: "open-in-view",
        flags: undefined,
        command: undefined,
        paths: [],
        message: "do not re-enable",
        severity: "warn",
        autogen: false,
        last_fired: recent,
      },
    });
    const fired = computeImpact(withSensor, usage({ read_count: 4, last_read_at: recent }), { now: NOW });
    const notFired = computeImpact(fm(), usage({ read_count: 4, last_read_at: recent }), { now: NOW });
    expect(fired.score).toBeGreaterThan(notFired.score);
    expect(fired.signals).toContain("sensor fired");
  });

  it("treats prevention events as a top-tier outcome signal (can reach high alone)", () => {
    const r = computeImpact(fm(), usage({ prevented_count: 3 }), { now: NOW });
    expect(r.tier).toBe("high");
    expect(r.signals.join(" ")).toContain("prevented 3×");
  });

  it("flags more-rejected-than-read as a prune candidate", () => {
    const r = computeImpact(fm(), usage({ read_count: 1, last_read_at: recent, rejected_count: 3 }), { now: NOW });
    expect(r.pruneCandidate).toBe(true);
  });

  it("never prunes a memory carrying a sensor", () => {
    const withSensor = fm({
      sensor: {
        kind: "regex",
        pattern: "x",
        flags: undefined,
        command: undefined,
        paths: [],
        message: "m",
        severity: "warn",
        autogen: true,
        last_fired: null,
      },
    });
    const r = computeImpact(withSensor, usage({ rejected_count: 5 }), { now: NOW });
    expect(r.pruneCandidate).toBe(false);
  });

  it("marks an unused, old memory as dormant and prune-worthy", () => {
    const r = computeImpact(fm({ created_at: old }), usage(), { now: NOW });
    expect(r.tier).toBe("dormant");
    expect(r.pruneCandidate).toBe(true);
  });

  it("dormancy clock resets on a recent applied outcome", () => {
    const r = computeImpact(
      fm({ created_at: old }),
      usage({ applied_count: 1, last_applied_at: recent }),
      { now: NOW },
    );
    expect(r.tier).not.toBe("dormant");
    expect(r.pruneCandidate).toBe(false);
  });

  it("collapses the score for stale status", () => {
    const r = computeImpact(fm({ status: "stale" }), usage({ read_count: 20, last_read_at: recent }), { now: NOW });
    expect(r.signals.join(" ")).toContain("status=stale");
    expect(r.pruneCandidate).toBe(true);
  });
});

describe("compareImpact + summarizeImpact", () => {
  it("orders highest score first", () => {
    const high = computeImpact(fm(), usage({ applied_count: 4, last_applied_at: recent }), { now: NOW });
    const low = computeImpact(fm(), usage(), { now: NOW });
    expect([low, high].sort(compareImpact)[0]).toBe(high);
  });

  it("rolls up tier counts", () => {
    const scores = [
      computeImpact(fm(), usage({ applied_count: 4, last_applied_at: recent }), { now: NOW }),
      computeImpact(fm({ created_at: old }), usage(), { now: NOW }),
    ];
    const s = summarizeImpact(scores);
    expect(s.total).toBe(2);
    expect(s.high).toBe(1);
    expect(s.dormant).toBe(1);
    expect(s.prune_candidates).toBe(1);
  });
});

describe("feedback adjustment recommendations", () => {
  it("downgrades a contested block sensor to warn", () => {
    const withBlock = fm({
      sensor: {
        kind: "regex",
        pattern: "legacyField",
        flags: undefined,
        command: undefined,
        paths: [],
        message: "do not reintroduce legacyField",
        severity: "block",
        autogen: true,
        last_fired: null,
      },
    });
    const adjustment = recommendFeedbackAdjustment(withBlock, usage({ rejected_count: 1 }));
    expect(adjustment.action).toBe("downgrade-block-sensor");
    const next = applyFeedbackAdjustment(withBlock, adjustment, NOW);
    expect(next.sensor?.severity).toBe("warn");
    expect(next.tags).toContain("feedback-contested");
  });

  it("deprecates repeatedly rejected memories with no positive outcome", () => {
    const adjustment = recommendFeedbackAdjustment(fm(), usage({ rejected_count: 2 }));
    expect(adjustment.action).toBe("deprecate-memory");
    const next = applyFeedbackAdjustment(fm(), adjustment, NOW);
    expect(next.status).toBe("deprecated");
    expect(next.stale_reason).toContain("rejection");
  });

  it("does not deprecate a memory with prevention outcomes", () => {
    const adjustment = recommendFeedbackAdjustment(fm(), usage({ rejected_count: 3, prevented_count: 1 }));
    expect(adjustment.action).toBe("none");
  });
});

describe("usage outcome recording (backward compatible)", () => {
  it("recordApplied increments applied_count and timestamp", () => {
    const index = { version: 1 as const, updated_at: NOW.toISOString(), by_id: {} };
    recordApplied(index, "m1");
    recordApplied(index, "m1");
    const u = getUsage(index, "m1");
    expect(u.applied_count).toBe(2);
    expect(u.last_applied_at).not.toBeNull();
  });

  it("normalizes legacy usage records missing the applied_* fields", () => {
    // Simulate a usage.json written before applied_count existed.
    const legacy = { read_count: 5, last_read_at: recent, rejected_count: 0, last_rejected_at: null, rejection_reason: null };
    const index = { version: 1 as const, updated_at: NOW.toISOString(), by_id: { m1: legacy as MemoryUsage } };
    const u = getUsage(index, "m1");
    expect(u.applied_count).toBe(0);
    expect(u.last_applied_at).toBeNull();
    expect(u.read_count).toBe(5);
    // recordRejection on a legacy record still works
    recordRejection(index, "m1", "wrong");
    expect(getUsage(index, "m1").rejected_count).toBe(1);
  });

  it("recordPrevention counts a catch and debounces rapid re-scans of the same diff", () => {
    const index = { version: 1 as const, updated_at: NOW.toISOString(), by_id: {} };
    const t0 = NOW.getTime();
    expect(recordPrevention(index, "m1", t0)).toBe(true);
    // A second catch within the debounce window does NOT inflate the count.
    expect(recordPrevention(index, "m1", t0 + 1000)).toBe(false);
    expect(getUsage(index, "m1").prevented_count).toBe(1);
    // A catch after the window counts again.
    expect(recordPrevention(index, "m1", t0 + PREVENTION_DEBOUNCE_MS + 1)).toBe(true);
    expect(getUsage(index, "m1").prevented_count).toBe(2);
    expect(getUsage(index, "m1").last_prevented_at).not.toBeNull();
  });
});
