import { describe, expect, it } from "vitest";
import {
  computePreventionTrend,
  computeRecurrence,
  type PreventionEvent,
} from "../src/prevention.js";

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
