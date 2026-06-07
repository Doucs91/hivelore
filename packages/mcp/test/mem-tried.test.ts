import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { memTried } from "../src/tools/mem-tried.js";

/**
 * Ratchet visibility: a captured lesson only CLOSES the loop if it carries a sensor the gate can fire.
 * memTried must tell the agent whether the loop closed (sensor_generated) and, when it didn't, why —
 * otherwise a paths-less capture silently stays advisory-only.
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

  it("generates a sensor and reports the loop closed when given paths + a distinctive token", async () => {
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
    expect(out.sensor_generated).toBe(true);
    // A heuristic warn sensor was generated; the hint now nudges the agent to upgrade it to a
    // reliable, validated block via propose_sensor.
    expect(out.hint).toMatch(/propose_sensor/);
  });

  it("flags the loop as OPEN with a paths hint when no paths are given", async () => {
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
    expect(out.sensor_generated).toBe(false);
    expect(out.hint).toMatch(/paths/i);
  });
});
