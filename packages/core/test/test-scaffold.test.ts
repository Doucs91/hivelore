import { describe, expect, it } from "vitest";
import {
  lessonShortName,
  normalizeFramework,
  parseLessonFields,
  pickTestFramework,
  scaffoldPostIncidentTest,
  incidentHintsFromDiff,
  type PostIncidentLesson,
  assessScaffoldLoop,
  extractTestFilePathsFromCommand,
  hasPendingTestMarker,
  buildProposeCommand,
} from "../src/test-scaffold.js";

const LESSON: PostIncidentLesson = {
  memoryId: "2026-07-03-attempt-refund-exceeds-capture",
  title: "refund exceeded the captured amount",
  whyFailed: "prod incident #442 — refunds must clamp to the captured amount",
  instead: "clamp the refund to the capture",
  incident: "prod #442",
  paths: ["src/payments/"],
};

describe("lessonShortName", () => {
  it("strips the date + type id prefix to the descriptive slug", () => {
    expect(lessonShortName("2026-07-03-attempt-refund-exceeds-capture")).toBe("refund-exceeds-capture");
    expect(lessonShortName("2026-01-01-gotcha-Stripe_Missing.Idempotency")).toBe("stripe-missing-idempotency");
  });
  it("never returns empty", () => {
    expect(lessonShortName("weird-id-no-prefix").length).toBeGreaterThan(0);
  });
});

describe("parseLessonFields", () => {
  it("extracts what / why / instead from a mem_tried-shaped body", () => {
    const body = [
      "# importing moment.js", "",
      "**Why it failed / do NOT use:** bundle bloat — team standard is date-fns", "",
      "**Instead, use:** date-fns", "",
    ].join("\n");
    expect(parseLessonFields(body)).toEqual({
      title: "importing moment.js",
      whyFailed: "bundle bloat — team standard is date-fns",
      instead: "date-fns",
    });
  });
});

describe("scaffoldPostIncidentTest", () => {
  it("vitest: pending test with provenance + wiring command carrying the incident", () => {
    const s = scaffoldPostIncidentTest(LESSON, { framework: "vitest" });
    expect(s.relPath).toBe("tests/incidents/refund-exceeds-capture.test.ts");
    expect(s.runCommand).toBe("npx vitest run tests/incidents/refund-exceeds-capture.test.ts");
    expect(s.content).toContain('import { describe, it, expect } from "vitest";');
    expect(s.content).toContain("it.todo(");
    // provenance travels into the file header
    expect(s.content).toContain("2026-07-03-attempt-refund-exceeds-capture");
    expect(s.content).toContain("Incident: prod #442");
    // arming command is validated propose_sensor, never armed here
    expect(s.proposeCommand).toContain("hivelore sensors propose 2026-07-03-attempt-refund-exceeds-capture");
    expect(s.proposeCommand).toContain("--kind test");
    expect(s.proposeCommand).toContain('--incident "prod #442"');
    expect(s.proposeCommand).toContain('--paths "src/payments/"');
    expect(s.content).toContain(s.proposeCommand); // the header shows how to arm it
  });

  it("jest: no vitest import, runs via npx jest", () => {
    const s = scaffoldPostIncidentTest(LESSON, { framework: "jest" });
    expect(s.content).not.toContain('from "vitest"');
    expect(s.content).toContain("it.todo(");
    expect(s.runCommand).toBe("npx jest tests/incidents/refund-exceeds-capture.test.ts");
  });

  it("pytest: skipped test function, pytest run command", () => {
    const s = scaffoldPostIncidentTest(LESSON, { framework: "pytest" });
    expect(s.relPath).toBe("tests/incidents/test_refund_exceeds_capture.py");
    expect(s.content).toContain("@pytest.mark.skip");
    expect(s.content).toContain("def test_refund_exceeds_capture():");
    expect(s.runCommand).toBe("pytest tests/incidents/test_refund_exceeds_capture.py");
  });

  it("gotest: skipped Test func, go test dir command", () => {
    const s = scaffoldPostIncidentTest(LESSON, { framework: "gotest" });
    expect(s.content).toContain("func TestRefundExceedsCapture(t *testing.T)");
    expect(s.content).toContain("t.Skip(");
    expect(s.runCommand).toBe("go test ./incidents/");
  });

  it("honors an outPath override and reflects it in the run command", () => {
    const s = scaffoldPostIncidentTest(LESSON, { framework: "vitest", outPath: "src/payments/refund.incident.test.ts" });
    expect(s.relPath).toBe("src/payments/refund.incident.test.ts");
    expect(s.runCommand).toBe("npx vitest run src/payments/refund.incident.test.ts");
  });

  it("omits the incident/paths flags when the lesson has none", () => {
    const s = scaffoldPostIncidentTest({ memoryId: "2026-07-03-attempt-x", title: "x" }, { framework: "vitest" });
    expect(s.proposeCommand).not.toContain("--incident");
    expect(s.proposeCommand).not.toContain("--paths");
  });

  it("prefixes baseDir into the path + run command (monorepo package)", () => {
    const s = scaffoldPostIncidentTest(LESSON, { framework: "vitest", baseDir: "packages/api" });
    expect(s.relPath).toBe("packages/api/tests/incidents/refund-exceeds-capture.test.ts");
    expect(s.runCommand).toBe("npx vitest run packages/api/tests/incidents/refund-exceeds-capture.test.ts");
  });

  it("baseDir scopes the go test directory", () => {
    const s = scaffoldPostIncidentTest(LESSON, { framework: "gotest", baseDir: "services/pay" });
    expect(s.relPath).toBe("services/pay/incidents/incident_refund_exceeds_capture_test.go");
    expect(s.runCommand).toBe("go test ./services/pay/incidents/");
  });

  it("outPath wins over baseDir", () => {
    const s = scaffoldPostIncidentTest(LESSON, { framework: "vitest", baseDir: "packages/api", outPath: "custom/x.test.ts" });
    expect(s.relPath).toBe("custom/x.test.ts");
  });

  it("stays a PENDING stub even when enriched with incident hints (suite must stay green)", () => {
    const s = scaffoldPostIncidentTest(
      { ...LESSON, incidentHints: { redRef: "abc123", changedFiles: ["src/payments/refund.ts"], changedSymbols: ["refund"] } },
      { framework: "vitest" },
    );
    // still pending (it.todo) and no LIVE import that could fail to resolve
    expect(hasPendingTestMarker(s.content)).toBe(true);
    expect(s.content).toContain("it.todo(");
    // the enriched example names the real subject and stays commented
    expect(s.content).toContain("Fix (abc123..HEAD) touched: refund in src/payments/refund.ts.");
    expect(s.content).toContain("//   import { refund } from \"src/payments/refund\";");
    expect(s.content).toContain("//   expect(refund(/* incident input */)).toBe(/* post-fix expected */);");
    // the only NON-comment executable line is still the pending todo
    const liveImport = s.content.split("\n").find((l) => /^\s*import\b/.test(l) && l.includes("refund.ts"));
    expect(liveImport).toBeUndefined();
  });

  it("style=property: emits a fast-check property skeleton, still pending, naming the subject + invariant", () => {
    const s = scaffoldPostIncidentTest(
      {
        ...LESSON,
        instead: "clamp with Math.min(amount, captured)",
        incidentHints: { changedFiles: ["src/payments/refund.ts"], changedSymbols: ["refund"] },
      },
      { framework: "vitest", style: "property" },
    );
    expect(hasPendingTestMarker(s.content)).toBe(true); // suite stays green
    expect(s.content).toContain("Style: property-based");
    expect(s.content).toContain("fast-check");
    expect(s.content).toContain("fc.assert(fc.property(fc.integer(), fc.integer(), (a, b) =>");
    expect(s.content).toContain("the boolean invariant over refund(a, b)");
    expect(s.content).toContain("Invariant (from the lesson): clamp with Math.min(amount, captured)");
    // no LIVE fast-check import (must stay commented)
    expect(s.content.split("\n").some((l) => /^\s*import\s+fc\b/.test(l))).toBe(false);
  });

  it("style=differential: asserts the subject agrees with the reference, still pending", () => {
    const s = scaffoldPostIncidentTest(
      { ...LESSON, incidentHints: { changedFiles: ["src/payments/refund.ts"], changedSymbols: ["refund"] } },
      { framework: "vitest", style: "differential", reference: "../legacy/refund" },
    );
    expect(hasPendingTestMarker(s.content)).toBe(true);
    expect(s.content).toContain("Style: differential");
    expect(s.content).toContain('import { refund as reference } from "../legacy/refund";');
    expect(s.content).toContain("refund(a, b) === reference(a, b)");
  });

  it("style=property for pytest uses Hypothesis @given", () => {
    const s = scaffoldPostIncidentTest(
      { ...LESSON, incidentHints: { changedFiles: ["api/refund.py"], changedSymbols: ["clamp_refund"] } },
      { framework: "pytest", style: "property" },
    );
    expect(s.content).toContain("from hypothesis import given, strategies as st");
    expect(s.content).toContain("@given(st.integers(), st.integers())");
    expect(s.content).toContain("clamp_refund(a, b)");
    expect(hasPendingTestMarker(s.content)).toBe(true);
  });

  it("default style is unchanged (example) — no property/differential scaffolding leaks in", () => {
    const s = scaffoldPostIncidentTest(LESSON, { framework: "vitest" });
    expect(s.content).not.toContain("fast-check");
    expect(s.content).not.toContain("Style: ");
    expect(s.content).toContain("it.todo(");
  });

  it("pytest/gotest scaffolds name the subject symbol from hints", () => {
    const hints = { changedFiles: ["api/refund.py"], changedSymbols: ["clamp_refund"] };
    const py = scaffoldPostIncidentTest({ ...LESSON, incidentHints: hints }, { framework: "pytest" });
    expect(py.content).toContain("clamp_refund");
    expect(py.content).toContain("@pytest.mark.skip");
    const go = scaffoldPostIncidentTest({ ...LESSON, incidentHints: { changedFiles: ["pay/refund.go"], changedSymbols: ["ClampRefund"] } }, { framework: "gotest" });
    expect(go.content).toContain("ClampRefund");
    expect(go.content).toContain("t.Skip(");
  });
});

describe("incidentHintsFromDiff", () => {
  it("extracts changed exported symbols and files from a fix diff", () => {
    const diff = [
      "diff --git a/src/payments/refund.ts b/src/payments/refund.ts",
      "--- a/src/payments/refund.ts",
      "+++ b/src/payments/refund.ts",
      "-export function refund(a, c) { return a; }",
      "+export function refund(a, c) { return Math.min(a, c); }",
      "+export const CAP = 100;",
    ].join("\n");
    const hints = incidentHintsFromDiff(diff, { redRef: "abc123" });
    expect(hints.redRef).toBe("abc123");
    expect(hints.changedFiles).toEqual(["src/payments/refund.ts"]);
    expect(hints.changedSymbols).toEqual(["refund", "CAP"]);
  });

  it("recognises python def and go func definitions", () => {
    const diff = [
      "+++ b/api/refund.py",
      "+def clamp_refund(amount, captured):",
      "+++ b/pay/refund.go",
      "+func ClampRefund(a int) int {",
      "+func (s *Svc) Charge(x int) {",
    ].join("\n");
    const hints = incidentHintsFromDiff(diff);
    expect(hints.changedSymbols).toEqual(["clamp_refund", "ClampRefund", "Charge"]);
    expect(hints.changedFiles).toEqual(["api/refund.py", "pay/refund.go"]);
  });

  it("prioritises the enclosing function (hunk header) over an incidental new const", () => {
    // The fix changed refund's BODY (signature line untouched) and added an unrelated const. Git puts
    // the enclosing function in the hunk header, so `refund` must rank ahead of the new `MAX_REFUND`.
    const diff = [
      "diff --git a/src/payments/refund.ts b/src/payments/refund.ts",
      "--- a/src/payments/refund.ts",
      "+++ b/src/payments/refund.ts",
      "@@ -1,3 +1,4 @@ export function refund(amount, captured) {",
      "-  return amount;",
      "+  return Math.min(amount, captured);",
      "+export const MAX_REFUND = 100;",
    ].join("\n");
    const hints = incidentHintsFromDiff(diff);
    expect(hints.changedSymbols[0]).toBe("refund");
    expect(hints.changedSymbols).toContain("MAX_REFUND");
  });

  it("returns empty hints for a diff with no definitions", () => {
    const diff = "+++ b/README.md\n+Some prose change with no code.\n";
    const hints = incidentHintsFromDiff(diff);
    expect(hints.changedSymbols).toEqual([]);
  });
});

describe("normalizeFramework", () => {
  it("maps aliases and rejects unknown", () => {
    expect(normalizeFramework("vitest")).toBe("vitest");
    expect(normalizeFramework("PY")).toBe("pytest");
    expect(normalizeFramework("python")).toBe("pytest");
    expect(normalizeFramework("go")).toBe("gotest");
    expect(normalizeFramework("cypress")).toBeNull();
  });
});

describe("pickTestFramework", () => {
  it("prefers vitest, then jest, from package deps", () => {
    expect(pickTestFramework({ devDependencies: { vitest: "^2" } }, {})).toBe("vitest");
    expect(pickTestFramework({ devDependencies: { jest: "^29" } }, {})).toBe("jest");
    expect(pickTestFramework({ devDependencies: { "ts-jest": "^29" } }, {})).toBe("jest");
  });
  it("falls back to non-JS signals, then vitest default", () => {
    expect(pickTestFramework(null, { goMod: true })).toBe("gotest");
    expect(pickTestFramework(null, { pySignal: true })).toBe("pytest");
    expect(pickTestFramework(null, {})).toBe("vitest");
  });
});

describe("assessScaffoldLoop — behaviour-loop accounting", () => {
  const scaffoldContent = (id: string, pending: boolean): string =>
    `// Post-incident guard generated by Hivelore from ${id}.\n` +
    `// What failed: x\n` +
    (pending ? `it.todo("reproduces ${id} and stays fixed");\n` : `it("guards", () => {});\n`);

  it("reports a pending stub and an unarmed lesson; closed loops are silent", () => {
    const gaps = assessScaffoldLoop(
      [
        { path: "tests/incidents/a.test.ts", content: scaffoldContent("2026-07-01-attempt-a", true) },
        { path: "tests/incidents/b.test.ts", content: scaffoldContent("2026-07-01-attempt-b", false) },
        { path: "tests/incidents/c.test.ts", content: scaffoldContent("2026-07-01-attempt-c", false) },
      ],
      [
        { id: "2026-07-01-attempt-a", sensorKind: null },
        { id: "2026-07-01-attempt-b", sensorKind: null },
        { id: "2026-07-01-attempt-c", sensorKind: "test" },
      ],
    );
    expect(gaps.map((g) => g.memory_id).sort()).toEqual(["2026-07-01-attempt-a", "2026-07-01-attempt-b"]);
    const a = gaps.find((g) => g.memory_id === "2026-07-01-attempt-a")!;
    expect(a.pending).toBe(true);
    expect(a.armed).toBe(false);
  });

  it("reports an armed lesson whose stub is still pending (empty oracle), and orphaned scaffolds", () => {
    const gaps = assessScaffoldLoop(
      [
        { path: "tests/incidents/a.test.ts", content: scaffoldContent("2026-07-01-attempt-a", true) },
        { path: "tests/incidents/gone.test.ts", content: scaffoldContent("2026-07-01-attempt-gone", false) },
      ],
      [{ id: "2026-07-01-attempt-a", sensorKind: "test" }],
    );
    expect(gaps.find((g) => g.memory_id === "2026-07-01-attempt-a")!.pending).toBe(true);
    expect(gaps.find((g) => g.memory_id === "2026-07-01-attempt-gone")!.memory_missing).toBe(true);
  });

  it("ignores files without the provenance marker; a regex sensor does not count as armed", () => {
    const gaps = assessScaffoldLoop(
      [
        { path: "tests/incidents/manual.test.ts", content: "it(\"hand-written\", () => {});" },
        { path: "tests/incidents/r.test.ts", content: scaffoldContent("2026-07-01-attempt-r", false) },
      ],
      [{ id: "2026-07-01-attempt-r", sensorKind: "regex" }],
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.memory_id).toBe("2026-07-01-attempt-r");
    expect(gaps[0]!.armed).toBe(false);
  });
});

describe("buildProposeCommand + proposeCommandOverride", () => {
  it("chains a shared proposal into every generated file when overridden", () => {
    const lesson = { memoryId: "2026-07-01-attempt-multi", title: "spans two packages", paths: ["packages/a/src/x.ts", "packages/b/src/y.ts"] };
    const combined = buildProposeCommand(lesson, "npx vitest run a && npx jest b");
    const scaffold = scaffoldPostIncidentTest(lesson, {
      framework: "vitest",
      baseDir: "packages/a",
      proposeCommandOverride: combined,
    });
    expect(scaffold.proposeCommand).toBe(combined);
    expect(scaffold.content).toContain(combined);
    expect(combined).toContain("--kind test");
    expect(combined).toContain("packages/a/src/x.ts,packages/b/src/y.ts");
  });
});

describe("pending-oracle helpers", () => {
  it("hasPendingTestMarker detects todo/skip stubs across frameworks", () => {
    expect(hasPendingTestMarker('it.todo("reproduces x");')).toBe(true);
    expect(hasPendingTestMarker("@pytest.mark.skip(reason='TODO')")).toBe(true);
    expect(hasPendingTestMarker('t.Skip("TODO: write the assertion")')).toBe(true);
    expect(hasPendingTestMarker('it("guards", () => { expect(1).toBe(1); });')).toBe(false);
  });

  it("extractTestFilePathsFromCommand pulls test files out of chained oracle commands", () => {
    expect(
      extractTestFilePathsFromCommand(
        'npx vitest run packages/api/tests/incidents/a.test.ts && npx jest "packages/web/tests/incidents/b.test.ts"',
      ),
    ).toEqual(["packages/api/tests/incidents/a.test.ts", "packages/web/tests/incidents/b.test.ts"]);
    expect(extractTestFilePathsFromCommand("pytest tests/incidents/test_refund.py -q")).toEqual([
      "tests/incidents/test_refund.py",
    ]);
    // Non-test tokens (binaries, flags, scripts) are never mistaken for oracle files.
    expect(extractTestFilePathsFromCommand("node scripts/check.mjs --strict")).toEqual([]);
  });
});
