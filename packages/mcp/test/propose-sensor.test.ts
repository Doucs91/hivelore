import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMemoriesFromDir, resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { memTried } from "../src/tools/mem-tried.js";
import { proposeSensor } from "../src/tools/propose-sensor.js";

/**
 * propose_sensor: the agent proposes a sensor; core validates it before trusting it to block.
 * A discriminating proposal (silent on the correct code, fires on the bad example) is accepted;
 * a broad proposal that matches the current correct code is rejected and NOT written.
 */
describe("proposeSensor — agent proposes, core validates", () => {
  let workDir: string;
  let ctx: HaiveContext;
  let memoryId: string;
  const anchor = "src/pay.ts";
  const correctCode = [
    "export async function charge(a: number, key: string) {",
    "  return stripe.paymentIntents.create(",
    "    { amount: a },",
    "    { idempotencyKey: key },",
    "  );",
    "}",
  ].join("\n");

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-propose-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.haiveDir, { recursive: true });
    ctx = { paths };
    // The anchored file currently holds CORRECT code (idempotencyKey present).
    await mkdir(path.join(workDir, "src"), { recursive: true });
    await writeFile(path.join(workDir, anchor), correctCode, "utf8");
    // A captured lesson to attach the sensor to.
    const tried = await memTried(
      {
        what: "stripe.paymentIntents.create without an idempotencyKey",
        why_failed: "a retry double-charged the customer",
        instead: "pass { idempotencyKey } as the second arg",
        scope: "team",
        module: undefined,
        tags: [],
        paths: [anchor],
        author: undefined,
      },
      ctx,
    );
    memoryId = tried.id;
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function loadSensor() {
    const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
    return all.find(({ memory }) => memory.frontmatter.id === memoryId)?.memory.frontmatter.sensor;
  }

  it("accepts a discriminating block proposal (silent on current, fires on bad)", async () => {
    const out = await proposeSensor(
      {
        memory_id: memoryId,
        pattern: "stripe\\.paymentIntents\\.create",
        absent: "idempotencyKey",
        bad_example: "stripe.paymentIntents.create({ amount: 1 });",
        severity: "block",
        message: undefined,
        flags: undefined,
        paths: [],
      },
      ctx,
    );
    expect(out.accepted).toBe(true);
    expect(out.self_check.silent_on_current).toBe(true);
    expect(out.self_check.fires_on_bad).toBe(true);
    const sensor = await loadSensor();
    expect(sensor?.severity).toBe("block");
    expect(sensor?.absent).toBe("idempotencyKey");
  });

  it("rejects a broad block proposal that fires on the current correct code, and does NOT write it", async () => {
    const before = await loadSensor();
    const out = await proposeSensor(
      {
        memory_id: memoryId,
        pattern: "stripe\\.paymentIntents\\.create",
        absent: undefined, // broad — matches correct usage too
        bad_example: undefined,
        severity: "block",
        message: undefined,
        flags: undefined,
        paths: [],
      },
      ctx,
    );
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe("fires-on-current");
    expect(out.self_check.fired_on).toContain(anchor);
    // unchanged on disk
    expect(await loadSensor()).toEqual(before);
  });

  it("validates against HEAD, not the working tree still holding the documented bad pattern", async () => {
    // The realistic sequence: the agent writes the bad pattern, hits the failure, calls mem_tried,
    // then proposes a sensor — all BEFORE reverting. The uncommitted bad code must not reject the
    // proposal with fires-on-current; HEAD (last gated state) is the presumed-correct baseline.
    execSync("git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm init", {
      cwd: workDir,
    });
    await writeFile(
      path.join(workDir, anchor),
      `${correctCode}\nstripe.paymentIntents.create({ amount: 2 });\n`,
      "utf8",
    );
    const out = await proposeSensor(
      {
        memory_id: memoryId,
        pattern: "stripe\\.paymentIntents\\.create",
        absent: "idempotencyKey",
        bad_example: "stripe.paymentIntents.create({ amount: 1 });",
        severity: "block",
        message: undefined,
        flags: undefined,
        paths: [],
      },
      ctx,
    );
    expect(out.accepted).toBe(true);
    expect(out.self_check.silent_on_current).toBe(true);
  });

  it("rejects an invalid regex without throwing", async () => {
    const out = await proposeSensor(
      {
        memory_id: memoryId,
        pattern: "(unclosed",
        absent: undefined,
        bad_example: undefined,
        severity: "block",
        message: undefined,
        flags: undefined,
        paths: [],
      },
      ctx,
    );
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe("invalid-regex");
  });
});
