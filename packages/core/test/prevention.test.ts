import { describe, expect, it } from "vitest";
import {
  briefingProofLine,
  computePreventionTrend,
  computeRecurrence,
  renderCaughtForYou,
  summarizeCaughtForYou,
  type PreventionEvent,
} from "../src/prevention.js";
import { emptyUsageIndex, recordPrevention } from "../src/usage.js";
import type { LoadedMemory } from "../src/loader.js";

const NOW = new Date("2026-06-30T12:00:00.000Z");

function ev(daysAgo: number, id: string, source: PreventionEvent["source"] = "sensor"): PreventionEvent {
  return { at: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(), id, source };
}

describe("computePreventionTrend", () => {
  it("buckets catches into 7d / 30d windows and weekly columns", () => {
    const events = [ev(0, "m1"), ev(3, "m1"), ev(10, "m2"), ev(40, "m3")];
    const t = computePreventionTrend(events, NOW, 6);
    expect(t.last_7d).toBe(2); // 0d + 3d
    expect(t.last_30d).toBe(3); // 0d + 3d + 10d (40d excluded)
    expect(t.weekly).toHaveLength(6);
    // newest week (last column) holds the two recent catches.
    expect(t.weekly[5]).toBe(2);
    // total bucketed never exceeds events within the window.
    expect(t.weekly.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(events.length);
  });

  it("ignores future-dated and malformed timestamps", () => {
    const events: PreventionEvent[] = [
      ev(-5, "future"),
      { at: "not-a-date", id: "bad", source: "sensor" },
      ev(1, "ok"),
    ];
    const t = computePreventionTrend(events, NOW);
    expect(t.last_7d).toBe(1);
  });
});

describe("computeRecurrence", () => {
  it("flags lessons caught on >= 2 distinct days as re-introduced after capture", () => {
    const events = [
      ev(0, "recurring"),
      ev(5, "recurring"), // different day → recurrence
      ev(0, "oneoff"),
    ];
    const r = computeRecurrence(events);
    expect(r.recurring_count).toBe(1);
    expect(r.top[0]?.id).toBe("recurring");
    expect(r.top[0]?.distinct_days).toBe(2);
    expect(r.top.some((row) => row.id === "oneoff")).toBe(false);
  });

  it("does not count multiple catches on the same day as recurrence", () => {
    const sameDay = [
      { at: "2026-06-01T09:00:00.000Z", id: "m1", source: "sensor" as const },
      { at: "2026-06-01T17:00:00.000Z", id: "m1", source: "anti-pattern" as const },
    ];
    const r = computeRecurrence(sameDay);
    expect(r.recurring_count).toBe(0);
  });
});

describe("briefingProofLine", () => {
  it("returns null when there are no recent prevention events", () => {
    expect(briefingProofLine([ev(40, "old")], { now: NOW })).toBeNull();
  });

  it("summarizes recent prevention as one proof line for briefing", () => {
    expect(briefingProofLine([ev(1, "m1"), ev(2, "m2")], { now: NOW })).toBe(
      "This harness prevented 2 repeated mistakes in the last 30 days.",
    );
  });
});

describe("summarizeCaughtForYou", () => {
  function loaded(id: string, body = "# Avoid legacyField\n\nUse currentField."): LoadedMemory {
    return {
      filePath: `/x/${id}.md`,
      memory: {
        frontmatter: {
          id,
          scope: "team",
          type: "gotcha",
          status: "validated",
          anchor: { paths: [], symbols: [] },
          tags: [],
          created_at: NOW.toISOString(),
          expires_when: null,
          verified_at: null,
          stale_reason: null,
          related_ids: [],
          last_read_at: null,
          revision_count: 0,
          requires_human_approval: false,
        },
        body,
      },
    } as LoadedMemory;
  }

  it("builds prevention count before/after rows from session events", () => {
    const usage = emptyUsageIndex();
    recordPrevention(usage, "m1", NOW.getTime() - 1000);
    recordPrevention(usage, "m1", NOW.getTime() + 10 * 60 * 1000);
    const summary = summarizeCaughtForYou(
      [ev(0, "m1", "anti-pattern"), ev(1, "m1", "sensor"), ev(20, "old")],
      [loaded("m1")],
      usage,
      { since: new Date(NOW.getTime() - 2 * 86_400_000), now: NOW },
    );
    expect(summary.total_catches).toBe(2);
    expect(summary.rows[0]!.title).toBe("Avoid legacyField");
    expect(summary.rows[0]!.current_count).toBe(2);
    expect(summary.rows[0]!.previous_count).toBe(1);
    expect(renderCaughtForYou(summary)).toContain("Prevention 1->2");
  });
});
