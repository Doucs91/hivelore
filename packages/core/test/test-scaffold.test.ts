import { describe, expect, it } from "vitest";
import {
  lessonShortName,
  normalizeFramework,
  parseLessonFields,
  pickTestFramework,
  scaffoldPostIncidentTest,
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
