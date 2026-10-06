import { describe, it, expect } from "vitest";
import { assessBenchmarkEvidence, type BenchmarkEvidenceRow, type BenchmarkProtocolRun } from "../src/benchmark-evidence.js";
function fixture(arms = ["plain", "context", "haive"]) {
  const rows: BenchmarkEvidenceRow[] = [], protocol: BenchmarkProtocolRun[] = [];
  for (let t = 1; t <= 10; t++) for (let r = 1; r <= 3; r++) for (const arm of arms) {
    protocol.push({ task: `task${t}`, repetition: r, arm, model: "model", checkout: "sha", budget: 1000, case_hash: "a".repeat(64) });
    rows.push({ fixture: `task${t}-r${r}-${arm}`, group: arm, model: "model", checkout: "sha", budget: "1000", prompt_hash: "prompt",
      human_interventions: 0, task_completed: true, tests_passed: true, policy_violations: 0, duration_seconds: 1, total_tokens: 100,
      runner_id: "runner", evaluator_id: "reviewer", independent_evaluation: true });
  }
  return { rows, protocol };
}
describe("benchmark evidence integrity", () => {
  it("requires protocol, repetitions, distinct tasks and independent comparable outcomes in every mode", () => {
    for (const arms of [["plain", "haive"], ["plain", "context", "haive"]]) {
      const { rows, protocol } = fixture(arms);
      expect(assessBenchmarkEvidence(rows, protocol).evidence_grade).toBe("decision-ready");
      expect(assessBenchmarkEvidence(rows).evidence_grade).toBe("insufficient");
      expect(assessBenchmarkEvidence(rows.slice(0, 6), protocol.slice(0, 6)).evidence_grade).toBe("insufficient");
      rows[0]!.model = "other-model";
      expect(assessBenchmarkEvidence(rows, protocol).comparison.comparable).toBe(false);
      expect(assessBenchmarkEvidence(rows, protocol).evidence_grade).toBe("insufficient");
    }
  });
  it("missing arms, duplicated reports, changed plans and self-evaluation cannot qualify", () => {
    const { rows, protocol } = fixture();
    for (const changed of [rows.slice(1), [...rows, rows[0]!], rows.filter(r => r.group !== "context")]) {
      expect(assessBenchmarkEvidence(changed, protocol).evidence_grade).toBe("insufficient");
    }
    protocol[0]!.budget = 2000;
    expect(assessBenchmarkEvidence(rows, protocol).comparison.protocol_matched).toBe(false);
    protocol[0]!.budget = 1000;
    rows[0]!.evaluator_id = "runner";
    expect(assessBenchmarkEvidence(rows, protocol).evidence_grade).toBe("insufficient");
  });
  it("ten repetitions of one task are not ten independent tasks", () => {
    const { rows } = fixture(["plain", "haive"]);
    const same = rows.map((r, i) => ({ ...r, fixture: `same-r${Math.floor(i / 2) + 1}-${r.group}` }));
    expect(assessBenchmarkEvidence(same)).toMatchObject({ evidence_grade: "insufficient", comparison: { distinct_tasks: 1 } });
  });
});
