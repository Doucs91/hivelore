import { describe, expect, it } from "vitest";
import { distillFailureObservations, findUncapturedFailures, type FailureObservation } from "../src/failure-coverage.js";

const NOW = new Date("2026-06-02T12:00:00.000Z");

function fail(ts: string, summary = "Bash: pnpm build", tool = "Bash"): FailureObservation {
  return { ts, tool, summary };
}

describe("findUncapturedFailures", () => {
  it("returns failures with no capture after them", () => {
    const failures = [fail("2026-06-02T10:00:00.000Z")];
    const out = findUncapturedFailures(failures, [], { now: NOW });
    expect(out).toHaveLength(1);
    expect(out[0]!.summary).toBe("Bash: pnpm build");
  });

  it("treats a failure as captured when an attempt was recorded after it", () => {
    const failures = [fail("2026-06-02T10:00:00.000Z")];
    const captures = ["2026-06-02T10:30:00.000Z"]; // lesson recorded after the failure
    expect(findUncapturedFailures(failures, captures, { now: NOW })).toHaveLength(0);
  });

  it("does NOT count a capture that predates the failure", () => {
    const failures = [fail("2026-06-02T10:00:00.000Z")];
    const captures = ["2026-06-02T09:00:00.000Z"]; // older than the failure
    expect(findUncapturedFailures(failures, captures, { now: NOW })).toHaveLength(1);
  });

  it("ignores failures older than the window", () => {
    const failures = [fail("2026-05-30T10:00:00.000Z")]; // ~50h ago
    expect(findUncapturedFailures(failures, [], { now: NOW, windowHours: 24 })).toHaveLength(0);
  });

  it("dedupes summaries that normalize to the same text", () => {
    // case + whitespace differences only → one row
    const same = findUncapturedFailures(
      [fail("2026-06-02T10:00:00.000Z", "Bash: pnpm build   FAILED"), fail("2026-06-02T10:05:00.000Z", "bash: PNPM build failed")],
      [],
      { now: NOW },
    );
    expect(same.length).toBe(1);
    // genuinely different text → both kept
    const distinct = findUncapturedFailures(
      [fail("2026-06-02T10:00:00.000Z", "Bash: pnpm build"), fail("2026-06-02T10:05:00.000Z", "Bash: tsc typecheck")],
      [],
      { now: NOW },
    );
    expect(distinct.length).toBe(2);
  });

  it("skips malformed timestamps", () => {
    const out = findUncapturedFailures([fail("not-a-date")], [], { now: NOW });
    expect(out).toHaveLength(0);
  });
});

describe("distillFailureObservations — passive-capture distillation", () => {
  const f = (ts: string, summary: string, files: string[] = [], tool = "Bash") => ({ ts, tool, summary, files });

  it("clusters retries of the same failure and orders by occurrence count", () => {
    const lessons = distillFailureObservations([
      f("2026-07-04T10:00:00Z", "Bash: pnpm test failed — 2 tests failing in refund.spec.ts", ["src/refund.ts"]),
      f("2026-07-04T10:05:00Z", "Bash: pnpm test failed — 2 tests failing   in refund.spec.ts", ["src/refund.ts"]),
      f("2026-07-04T10:06:00Z", "Edit failed: file has been modified since read", ["src/other.ts"], "Edit"),
    ]);
    expect(lessons).toHaveLength(2);
    expect(lessons[0]!.occurrences).toBe(2);
    expect(lessons[0]!.what).toContain("pnpm test failed");
    expect(lessons[0]!.paths).toEqual(["src/refund.ts"]);
  });

  it("drops exploratory lookups and caps at max", () => {
    const lessons = distillFailureObservations(
      [
        f("2026-07-04T10:00:00Z", "grep -rn pattern src returned nothing"),
        f("2026-07-04T10:01:00Z", "ls missing-dir"),
        f("2026-07-04T10:02:00Z", "npm run build exploded A"),
        f("2026-07-04T10:03:00Z", "npm run build exploded B"),
        f("2026-07-04T10:04:00Z", "npm run build exploded C"),
        f("2026-07-04T10:05:00Z", "npm run build exploded D"),
      ],
      { max: 3 },
    );
    expect(lessons).toHaveLength(3);
    expect(lessons.every((l) => !/grep|^ls/.test(l.what))).toBe(true);
  });
});
