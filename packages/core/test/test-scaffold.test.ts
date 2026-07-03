import { describe, expect, it } from "vitest";
import {
  lessonShortName,
  parseLessonFields,
  scaffoldPostIncidentTest,
  type PostIncidentLesson,
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
});
