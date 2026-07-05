import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hivelore/core";
import type { HaiveContext } from "../src/context.js";
import { astEngineAvailable, astLangForPath, runAstPattern, runAstSensorOnContent } from "../src/ast-sensors.js";
import { memTried } from "../src/tools/mem-tried.js";
import { proposeSensor } from "../src/tools/propose-sensor.js";

const CORRECT = [
  "export async function charge(a: number, key: string) {",
  "  // stripe.paymentIntents.create must carry an idempotencyKey",
  '  const note = "stripe.paymentIntents.create without key double-charges";',
  "  return stripe.paymentIntents.create({ amount: a }, { idempotencyKey: key });",
  "}",
].join("\n");

const FAULTY = [
  "export async function charge(a: number) {",
  "  return stripe.paymentIntents.create({ amount: a });",
  "}",
].join("\n");

describe("ast-sensors adapter — structural matching (requires @ast-grep/napi devDep)", () => {
  it("engine is available in the dev workspace", async () => {
    expect(await astEngineAvailable()).toBe(true);
  });

  it("maps built-in and installed dynamic language extensions", () => {
    expect(astLangForPath("src/a.ts")).toBe("TypeScript");
    expect(astLangForPath("src/a.tsx")).toBe("Tsx");
    expect(astLangForPath("src/a.mjs")).toBe("JavaScript");
    expect(astLangForPath("src/a.py")).toBe("python");
    expect(astLangForPath("src/a.go")).toBe("go");
    expect(astLangForPath("src/a.rs")).toBe("rust");
    expect(astLangForPath("src/A.java")).toBe("java");
  });

  it("supports full ast-grep rule objects and dynamic Python parsing", async () => {
    const rule = { kind: "call_expression", has: { pattern: "stripe.paymentIntents.create" } };
    expect((await runAstPattern(FAULTY, "src/pay.ts", undefined, "idempotencyKey", rule)).matches).toHaveLength(1);
    expect((await runAstPattern(CORRECT, "src/pay.ts", undefined, "idempotencyKey", rule)).matches).toHaveLength(0);

    const python = await runAstPattern('print("unsafe")\n', "tools/check.py", "print($A)");
    expect(python.status).toBe("ok");
    expect(python.matches).toHaveLength(1);
  });

  it("fires on the faulty call but NOT on comments/strings (the regex false-positive class) nor on the correct call", async () => {
    const pattern = "stripe.paymentIntents.create($$$)";
    const absent = "idempotencyKey";
    const bad = await runAstPattern(FAULTY, "src/pay.ts", pattern, absent);
    expect(bad.status).toBe("ok");
    expect(bad.matches).toHaveLength(1);
    expect(bad.matches[0]!.text).toContain("paymentIntents.create");

    // CORRECT contains the API name in a comment AND a string AND a correct call — zero hits.
    const good = await runAstPattern(CORRECT, "src/pay.ts", pattern, absent);
    expect(good.status).toBe("ok");
    expect(good.matches).toHaveLength(0);
  });

  it("intersects added lines: presence alone never fires, an introduction does", async () => {
    const pattern = "stripe.paymentIntents.create($$$)";
    // Match is on line 2 of FAULTY; added lines say only line 1 changed → no fire.
    const untouched = await runAstSensorOnContent({
      pattern, content: FAULTY, filePath: "src/pay.ts", addedLines: new Set([1]),
    });
    expect(untouched.matches).toHaveLength(0);
    const introduced = await runAstSensorOnContent({
      pattern, content: FAULTY, filePath: "src/pay.ts", addedLines: new Set([2]),
    });
    expect(introduced.matches).toHaveLength(1);
  });

  it("degrades safely on garbage patterns and unsupported languages (no throw, no phantom matches)", async () => {
    // ast-grep parses patterns leniently: garbage may yield ok-with-zero-matches instead of an error.
    const garbage = await runAstPattern("const a = 1;", "src/a.ts", "${{{");
    expect(["ok", "invalid-pattern"]).toContain(garbage.status);
    expect(garbage.matches).toHaveLength(0);
    expect((await runAstPattern("x = 1", "src/a.unknown", "x")).status).toBe("unsupported-language");
  });
});

describe("proposeSensor — kind=ast validation", () => {
  let workDir: string;
  let ctx: HaiveContext;
  let lessonId: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-ast-propose-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.haiveDir, { recursive: true });
    ctx = { paths };
    await mkdir(path.join(workDir, "src"), { recursive: true });
    await writeFile(path.join(workDir, "src/pay.ts"), CORRECT, "utf8");
    const tried = await memTried(
      {
        what: "stripe create without idempotency key",
        why_failed: "retry double-charged",
        scope: "team", tags: [], paths: ["src/pay.ts"],
      },
      ctx,
    );
    lessonId = tried.id;
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  const propose = (pattern: string, absent?: string, bad_example?: string) =>
    proposeSensor(
      {
        memory_id: lessonId, kind: "ast", pattern, absent, bad_example,
        command: undefined, timeout_ms: undefined, severity: "block",
        message: undefined, incident: undefined, red_ref: undefined, flags: undefined, paths: [],
      },
      ctx,
    );

  it("accepts a discriminating structural pattern (silent on current, fires on bad)", async () => {
    const out = await propose("stripe.paymentIntents.create($$$)", "idempotencyKey", FAULTY);
    expect(out.accepted).toBe(true);
    expect(out.self_check.silent_on_current).toBe(true);
    expect(out.self_check.fires_on_bad).toBe(true);
    const { readFile: rf } = await import("node:fs/promises");
    expect(await rf(out.file_path!, "utf8")).toContain("kind: ast");
  });

  it("rejects fires-on-current when the pattern lacks the absent companion", async () => {
    const out = await propose("stripe.paymentIntents.create($$$)", undefined, FAULTY);
    expect(out.accepted).toBe(false);
    expect(out.reason).toBe("fires-on-current");
  });

  it("rejects missed-bad-example — including garbage patterns that structurally match nothing", async () => {
    const missed = await propose("axios.post($$$)", undefined, FAULTY);
    expect(missed.accepted).toBe(false);
    expect(missed.reason).toBe("missed-bad-example");
    const garbage = await propose("$}{{", undefined, FAULTY);
    expect(garbage.accepted).toBe(false);
    expect(["missed-bad-example", "invalid-pattern"]).toContain(garbage.reason);
  });
});
