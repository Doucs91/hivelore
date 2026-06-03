import { describe, expect, it } from "vitest";
import { computeEvalTrend, type EvalHistoryEntry } from "../src/eval-history.js";

function e(at: string, score: number): EvalHistoryEntry {
  return { at, score };
}

describe("computeEvalTrend", () => {
  it("returns nulls for empty history", () => {
    const t = computeEvalTrend([]);
    expect(t.latest).toBeNull();
    expect(t.delta).toBeNull();
    expect(t.runs).toBe(0);
    expect(t.regressed).toBe(false);
  });

  it("computes latest/previous/delta/best in chronological order", () => {
    const t = computeEvalTrend([
      e("2026-06-01T00:00:00Z", 70),
      e("2026-06-03T00:00:00Z", 82),
      e("2026-06-02T00:00:00Z", 90), // out of order on purpose
    ]);
    // chronological: 70, 90, 82
    expect(t.latest).toBe(82);
    expect(t.previous).toBe(90);
    expect(t.delta).toBe(-8);
    expect(t.best).toBe(90);
    expect(t.runs).toBe(3);
    expect(t.regressed).toBe(true);
    expect(t.recent).toEqual([70, 90, 82]);
  });

  it("does not regress when the score rises", () => {
    const t = computeEvalTrend([e("2026-06-01T00:00:00Z", 60), e("2026-06-02T00:00:00Z", 75)]);
    expect(t.delta).toBe(15);
    expect(t.regressed).toBe(false);
  });
});
