import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendSensorEvaluations,
  assessSensorHealth,
  computeScopeHash,
  loadSensorLedger,
  quarantineNote,
  resolveHaivePaths,
  withQuarantineNote,
  withoutQuarantineNote,
  type SensorEvaluation,
} from "../src/index.js";

const NOW = new Date("2026-07-03T12:00:00.000Z");
const day = 86_400_000;
function ev(daysAgo: number, outcome: SensorEvaluation["outcome"], scope = "same"): SensorEvaluation {
  return {
    at: new Date(NOW.getTime() - daysAgo * day).toISOString(),
    memory_id: "sensor-a",
    kind: "test",
    stage: "pre-commit",
    head_sha: "abc",
    scope_hash: scope,
    outcome,
  };
}

describe("sensor ledger health", () => {
  it("counts only contradictory runnable outcomes on the identical scope hash", () => {
    expect(assessSensorHealth([ev(3, "silent"), ev(2, "fired")], NOW)[0]!.flap_count).toBe(1);
    expect(assessSensorHealth([ev(3, "silent", "a"), ev(2, "fired", "b")], NOW)[0]!.flap_count).toBe(0);
    expect(assessSensorHealth([ev(3, "silent"), ev(2, "unrunnable"), ev(1, "fired")], NOW)[0]!.flap_count).toBe(1);
  });

  it("uses a strict rolling 30-day window", () => {
    expect(assessSensorHealth([ev(31, "silent"), ev(1, "fired")], NOW)[0]!.flap_count).toBe(0);
  });

  it("quarantines after two flaps and writes the note idempotently", () => {
    const health = assessSensorHealth([ev(3, "silent"), ev(2, "fired"), ev(1, "silent")], NOW)[0]!;
    expect(health.quarantine_pending).toBe(true);
    const once = withQuarantineNote("# Lesson\n", NOW.toISOString(), health.flap_count);
    const twice = withQuarantineNote(once, NOW.toISOString(), health.flap_count);
    expect(twice).toBe(once);
    expect(once).toContain(quarantineNote(NOW.toISOString(), 2));
    expect(withoutQuarantineNote(once)).not.toContain("> Quarantined");
  });
});

describe("sensor ledger storage", () => {
  it("hashes sorted file contents and round-trips valid NDJSON", async () => {
    const root = path.join(tmpdir(), `haive-ledger-${process.pid}-${Date.now()}`);
    const paths = resolveHaivePaths(root);
    try {
      await mkdir(path.join(root, "src"), { recursive: true });
      await writeFile(path.join(root, "src/a.ts"), "a", "utf8");
      await writeFile(path.join(root, "src/b.ts"), "b", "utf8");
      expect(computeScopeHash(root, ["src/b.ts", "src/a.ts"])).toBe(computeScopeHash(root, ["src/a.ts", "src/b.ts"]));
      await appendSensorEvaluations(paths, [ev(0, "silent")]);
      expect(await loadSensorLedger(paths)).toHaveLength(1);
      expect(await readFile(path.join(paths.runtimeDir, "enforcement/sensor-ledger.ndjson"), "utf8")).toContain("sensor-a");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
