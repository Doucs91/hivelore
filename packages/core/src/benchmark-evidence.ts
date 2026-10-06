/** Evidence completeness is separate from authenticity or comparative superiority. */
export interface BenchmarkEvidenceRow {
  fixture: string;
  group: string;
  model: string | null;
  checkout: string | null;
  budget: string | null;
  prompt_hash: string | null;
  human_interventions: number | null;
  task_completed: boolean | null;
  tests_passed: boolean | null;
  policy_violations: number | null;
  duration_seconds: number | null;
  total_tokens: number | null;
  runner_id: string | null;
  evaluator_id: string | null;
  independent_evaluation: boolean | null;
}
export interface BenchmarkProtocolRun {
  task: string; repetition: number; arm: string; model: string; checkout: string; budget: number; case_hash: string;
}
export function assessBenchmarkEvidence(rows: BenchmarkEvidenceRow[], protocol?: BenchmarkProtocolRun[]) {
  const key = (r: BenchmarkEvidenceRow) => r.fixture.replace(/-(haive|plain|context)$/, "");
  const task = (r: BenchmarkEvidenceRow) => key(r).replace(/-r\d+$/, "");
  const groups = rows.some(r => r.group === "context") ? ["plain", "context", "haive"] : ["plain", "haive"];
  const tasks = new Set(rows.map(task));
  const pairs = new Set(rows.filter(r => r.group === "haive" && rows.some(p => p.group === "plain" && key(p) === key(r))).map(key));
  const comparable = rows.length > 0 && rows.every(row => {
    const peers = rows.filter(p => key(p) === key(row));
    return peers.length === groups.length && groups.every(g => peers.some(p => p.group === g)) &&
      ["model", "checkout", "budget", "prompt_hash"].every(field => {
        const value = row[field as keyof BenchmarkEvidenceRow];
        return typeof value === "string" && value.trim() && !/^(todo|unknown|n\/a)$/i.test(value) &&
          peers.every(p => p[field as keyof BenchmarkEvidenceRow] === value);
      });
  });
  const repeated = rows.length > 0 && [...tasks].every(t => groups.every(g =>
    rows.filter(r => task(r) === t && r.group === g && /-r[1-9]\d*-/.test(r.fixture)).length >= 3));
  const outcomeComplete = rows.length > 0 && rows.every(r =>
    typeof r.task_completed === "boolean" && typeof r.tests_passed === "boolean" &&
    [r.policy_violations, r.duration_seconds, r.total_tokens, r.human_interventions].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) &&
    Boolean(r.runner_id) && Boolean(r.evaluator_id) && r.runner_id !== r.evaluator_id && r.independent_evaluation === true);
  const expected = protocol?.map(r => `${r.task}-r${r.repetition}-${r.arm}`);
  const protocolMatched = Boolean(protocol?.length && expected && new Set(expected).size === expected.length &&
    expected.length === rows.length && protocol.every((run, i) => {
      const row = rows.find(r => r.fixture === expected[i]);
      return row && /^[a-zA-Z0-9_-]+$/.test(run.task) && Number.isInteger(run.repetition) && run.repetition > 0 &&
        Number.isInteger(run.budget) && run.budget > 0 &&
        protocol.filter(p => p.task === run.task).every(p => p.case_hash === run.case_hash) &&
        groups.includes(run.arm) && typeof run.case_hash === "string" && /^[a-f0-9]{64}$/.test(run.case_hash) &&
        row.group === run.arm && row.model === run.model && row.checkout === run.checkout && row.budget === String(run.budget);
    }));
  const ready = tasks.size >= 10 && comparable && repeated && outcomeComplete && protocolMatched;
  return { paired_tasks: pairs.size, evidence_grade: ready ? "decision-ready" : "insufficient",
    evidence_origin: protocolMatched ? "protocol-matched-reports" : "unverified-import",
    evidence_reason: ready
      ? "At least 10 distinct tasks and 3 repetitions with matched protocol and comparable metadata. Outcomes and evaluator independence are reported, not authenticated; no statistical superiority inferred."
      : `Need >=10 distinct tasks, >=3 repetitions, comparable metadata, complete independent outcome attestations and a matching protocol: tasks=${tasks.size}, comparable=${comparable}, repeated=${repeated}, outcomes=${outcomeComplete}, protocol=${protocolMatched}.`,
    comparison: { comparable, repeated, distinct_tasks: tasks.size, three_arm: groups.length === 3, protocol_matched: protocolMatched } };
}
