import { describe, expect, it } from "vitest";
import { compareGatePrecision, computeGatePrecision, suggestGate } from "../src/gate-precision.js";
import type { PreventionEvent } from "../src/prevention.js";
import type { UsageIndex, MemoryUsage } from "../src/usage.js";

function usage(rows: Record<string, Partial<MemoryUsage>>): UsageIndex {
  const by_id: Record<string, MemoryUsage> = {};
  for (const [id, r] of Object.entries(rows)) {
    by_id[id] = {
      read_count: 0,
      last_read_at: null,
      rejected_count: 0,
      last_rejected_at: null,
      applied_count: 0,
      last_applied_at: null,
      prevented_count: 0,
      last_prevented_at: null,
      ...r,
    } as MemoryUsage;
  }
  return { version: 1, updated_at: "2026-06-01T00:00:00Z", by_id };
}

function ev(source: PreventionEvent["source"]): PreventionEvent {
  return { at: "2026-06-01T00:00:00Z", id: "m", source };
}

describe("computeGatePrecision", () => {
  it("returns null precision when there is no signal", () => {
    const p = computeGatePrecision([], usage({}), "anchored");
    expect(p.precision).toBeNull();
    expect(p.suggestion).toBeNull();
  });

  it("counts catches by source and computes precision against rejections", () => {
    const events = [ev("sensor"), ev("anti-pattern"), ev("anti-pattern")];
    const p = computeGatePrecision(events, usage({ a: { rejected_count: 1, applied_count: 1 } }), "anchored");
    expect(p.sensor_catches).toBe(1);
    expect(p.anti_pattern_catches).toBe(2);
    expect(p.useful).toBe(4); // 3 catches + 1 applied
    expect(p.rejections).toBe(1);
    expect(p.precision).toBe(0.8);
  });
});

describe("suggestGate", () => {
  it("recommends loosening to review when noisy", () => {
    const s = suggestGate(0.3, 5, "anchored");
    expect(s?.recommended).toBe("review");
  });
  it("recommends tightening to anchored when precise but soft", () => {
    const s = suggestGate(0.9, 4, "review");
    expect(s?.recommended).toBe("anchored");
  });
  it("stays silent without enough rejections", () => {
    expect(suggestGate(0.2, 1, "anchored")).toBeNull();
  });
});

describe("compareGatePrecision", () => {
  it("flags more rejection noise as a regression", () => {
    const baseline = computeGatePrecision([ev("anti-pattern")], usage({}), "anchored");
    const current = computeGatePrecision([ev("anti-pattern")], usage({ a: { rejected_count: 1 } }), "anchored");
    const delta = compareGatePrecision(baseline, current);
    expect(delta.false_positives_increased).toBe(true);
    expect(delta.regressed).toBe(true);
  });

  it("flags known precision drops", () => {
    const baseline = computeGatePrecision([ev("sensor"), ev("anti-pattern")], usage({}), "anchored");
    const current = computeGatePrecision([ev("sensor")], usage({ a: { rejected_count: 1 } }), "anchored");
    const delta = compareGatePrecision(baseline, current);
    expect(delta.precision_regressed).toBe(true);
    expect(delta.precision.delta).toBeLessThan(0);
  });
});
