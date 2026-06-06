import { describe, expect, it } from "vitest";
import {
  aggregateRetrieval,
  aggregateSensors,
  buildReport,
  compareEvalReports,
  overallScore,
  scoreRetrievalCase,
  scoreSensorCase,
  synthesizeSelfEvalCases,
  titleFromBody,
} from "../src/eval.js";
import type { LoadedMemory } from "../src/loader.js";
import type { Memory } from "../src/types.js";

describe("scoreRetrievalCase", () => {
  it("computes recall, precision, and best rank", () => {
    const r = scoreRetrievalCase("c1", ["m2"], ["m1", "m2", "m3"]);
    expect(r.recall).toBe(1);
    expect(r.hits).toEqual(["m2"]);
    expect(r.best_rank).toBe(2);
    expect(r.precision).toBeCloseTo(1 / 3, 3);
  });

  it("reports a miss when the expected id is absent", () => {
    const r = scoreRetrievalCase("c2", ["mX"], ["m1", "m2"]);
    expect(r.recall).toBe(0);
    expect(r.misses).toEqual(["mX"]);
    expect(r.best_rank).toBeNull();
  });
});

describe("aggregateRetrieval + mrr", () => {
  it("averages recall and reciprocal ranks", () => {
    const a = scoreRetrievalCase("a", ["m1"], ["m1"]); // rank 1 → rr 1
    const b = scoreRetrievalCase("b", ["m2"], ["x", "m2"]); // rank 2 → rr 0.5
    const c = scoreRetrievalCase("c", ["m3"], ["x", "y"]); // miss → rr 0
    const agg = aggregateRetrieval([a, b, c]);
    expect(agg.mean_recall).toBeCloseTo(2 / 3, 3);
    expect(agg.mrr).toBeCloseTo((1 + 0.5 + 0) / 3, 3);
  });

  it("authored-only score (slice past the synthesized cases) can differ from the blended headline", () => {
    // Mirrors the CLI eval honesty split: cases are ordered [synthesized..., authored...].
    const synthesized = [scoreRetrievalCase("s1", ["m1"], ["m1"]), scoreRetrievalCase("s2", ["m2"], ["m2"])]; // perfect
    const authored = [scoreRetrievalCase("a1", ["mX"], ["a", "b"])]; // a real miss
    const all = [...synthesized, ...authored];

    const blended = overallScore(aggregateRetrieval(all), null);
    const authoredOnly = overallScore(aggregateRetrieval(all.slice(synthesized.length)), null);

    expect(blended).toBe(67); // 2 perfect + 1 miss, retrieval-only weighting
    expect(authoredOnly).toBe(0); // the independent case actually missed — the honest number
    expect(authoredOnly).toBeLessThan(blended);
  });

  it("authored-only score counts authored SENSOR cases when there are no authored retrieval cases", () => {
    // Regression guard: when every authored case is a sensor (synthesis only makes retrieval cases),
    // the authored-only score must reflect the sensor catch-rate, not collapse to 0 on an empty slice.
    const authoredSensors = aggregateSensors([scoreSensorCase("a1", ["m1"], ["m1"])]); // catch-rate 1.0
    expect(overallScore(null, authoredSensors)).toBe(100);
  });
});

describe("sensor scoring", () => {
  it("computes catch-rate across cases", () => {
    const a = scoreSensorCase("a", ["m1"], ["m1"]); // hit
    const b = scoreSensorCase("b", ["m2"], []); // miss
    const agg = aggregateSensors([a, b]);
    expect(agg.catch_rate).toBe(0.5);
  });
});

describe("overallScore", () => {
  it("blends retrieval and sensors when both present", () => {
    const retr = aggregateRetrieval([scoreRetrievalCase("a", ["m1"], ["m1"])]); // recall 1, mrr 1
    const sens = aggregateSensors([scoreSensorCase("a", ["m1"], ["m1"])]); // catch 1
    expect(overallScore(retr, sens)).toBe(100);
  });

  it("uses retrieval-only weighting when no sensors", () => {
    const retr = aggregateRetrieval([scoreRetrievalCase("a", ["m1"], ["x", "m1"])]); // recall 1, mrr 0.5
    // 0.7*1 + 0.3*0.5 = 0.85
    expect(overallScore(retr, null)).toBe(85);
  });

  it("returns 0 with nothing to score", () => {
    expect(overallScore(null, null)).toBe(0);
    expect(buildReport(null, null).score).toBe(0);
  });
});

describe("compareEvalReports", () => {
  const baseline = buildReport(
    aggregateRetrieval([scoreRetrievalCase("a", ["m1"], ["x", "m1"])]), // recall 1, mrr 0.5 → 85
    aggregateSensors([scoreSensorCase("a", ["m1"], ["m1"])]), // catch 1
  );

  it("reports improvement with positive deltas", () => {
    const better = buildReport(
      aggregateRetrieval([scoreRetrievalCase("a", ["m1"], ["m1"])]), // recall 1, mrr 1
      aggregateSensors([scoreSensorCase("a", ["m1"], ["m1"])]),
    );
    const d = compareEvalReports(baseline, better);
    expect(d.improved).toBe(true);
    expect(d.regressed).toBe(false);
    expect(d.score.delta).toBeGreaterThan(0);
    expect(d.mrr!.delta).toBeCloseTo(0.5, 3);
  });

  it("flags a regression when score drops", () => {
    const worse = buildReport(
      aggregateRetrieval([scoreRetrievalCase("a", ["m1"], ["x", "y"])]), // miss → recall 0
      aggregateSensors([scoreSensorCase("a", ["m1"], [])]), // miss
    );
    const d = compareEvalReports(baseline, worse);
    expect(d.regressed).toBe(true);
    expect(d.score.delta).toBeLessThan(0);
    expect(d.catch_rate!.delta).toBeCloseTo(-1, 3);
  });

  it("returns null metric deltas when a family is absent on either side", () => {
    const retrievalOnly = buildReport(aggregateRetrieval([scoreRetrievalCase("a", ["m1"], ["m1"])]), null);
    const d = compareEvalReports(baseline, retrievalOnly);
    expect(d.catch_rate).toBeNull();
    expect(d.mean_recall).not.toBeNull();
  });
});

describe("titleFromBody", () => {
  it("prefers the first markdown heading", () => {
    expect(titleFromBody("# My rule\n\nbody text")).toBe("My rule");
  });
  it("falls back to the first non-empty line", () => {
    expect(titleFromBody("\n\njust a line\nmore")).toBe("just a line");
  });
});

describe("synthesizeSelfEvalCases", () => {
  function mem(id: string, status: string, paths: string[], type = "gotcha"): LoadedMemory {
    const memory = {
      frontmatter: {
        id, scope: "team", type, status,
        anchor: { paths, symbols: [] },
        tags: [], created_at: "2026-01-01T00:00:00.000Z",
        expires_when: null, verified_at: null, stale_reason: null,
        related_ids: [], last_read_at: null, revision_count: 0, requires_human_approval: false,
      },
      body: `# Title for ${id}\n\nbody`,
    } as unknown as Memory;
    return { memory, filePath: `/x/${id}.md` };
  }

  it("makes one case per anchored, non-dead, non-recap memory", () => {
    const cases = synthesizeSelfEvalCases([
      mem("m1", "validated", ["src/a.ts"]),
      mem("m2", "validated", []), // no anchor → skipped
      mem("m3", "stale", ["src/c.ts"]), // dead → skipped
      mem("m4", "validated", ["src/d.ts"], "session_recap"), // recap → skipped
    ]);
    expect(cases.map((c) => c.name)).toEqual(["m1"]);
    expect(cases[0]!.files).toEqual(["src/a.ts"]);
    expect(cases[0]!.task).toBe("Title for m1");
    expect(cases[0]!.expect_ids).toEqual(["m1"]);
  });

  it("omits files in semantic-only mode", () => {
    const cases = synthesizeSelfEvalCases([mem("m1", "validated", ["src/a.ts"])], { includeFiles: false });
    expect(cases[0]!.files).toBeUndefined();
  });
});
