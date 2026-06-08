import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { memTried } from "../src/tools/mem-tried.js";

/**
 * Ratchet visibility: a captured lesson is NOT enforced until a sensor is VALIDATED via propose_sensor.
 * memTried no longer auto-writes a heuristic warn sensor — it reports loop_open and, when a candidate
 * can be derived, hands the agent a proposed_sensor_seed to pre-fill that proposal.
 */
describe("memTried — ratchet visibility", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-tried-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.haiveDir, { recursive: true });
    ctx = { paths };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("leaves the loop open and offers a seed (no persisted sensor) when given paths + a distinctive token", async () => {
    const out = await memTried(
      {
        what: "used legacyClient.connect",
        why_failed: "legacyClient.connect deadlocks under load",
        instead: "use pooledClient.acquire",
        scope: "team",
        tags: [],
        paths: ["src/db.ts"],
      },
      ctx,
    );
    // The loop is OPEN until a sensor is validated via propose_sensor; no heuristic sensor is written.
    expect(out.loop_open).toBe(true);
    expect(out.proposed_sensor_seed?.pattern).toMatch(/legacyClient|connect/);
    expect(out.hint).toMatch(/propose_sensor/);
    const written = await readFile(out.file_path, "utf8");
    expect(written).not.toContain("sensor:");
  });

  it("flags the loop as OPEN with a paths hint and no seed when no paths are given", async () => {
    const out = await memTried(
      {
        what: "used legacyClient.connect",
        why_failed: "legacyClient.connect deadlocks under load",
        scope: "team",
        tags: [],
        paths: [],
      },
      ctx,
    );
    expect(out.loop_open).toBe(true);
    expect(out.proposed_sensor_seed).toBeUndefined();
    expect(out.hint).toMatch(/paths/i);
  });
});
