import { describe, expect, it } from "vitest";
import { mineSensorSeedFromDiff, suggestSensorFromMemory, suggestSensorSeed } from "../src/sensor-suggest.js";

describe("mineSensorSeedFromDiff — the strongest seed comes from the fix itself", () => {
  const FIX_DIFF = [
    "diff --git a/src/dates.ts b/src/dates.ts",
    "index 111..222 100644",
    "--- a/src/dates.ts",
    "+++ b/src/dates.ts",
    "@@ -1,3 +1,3 @@",
    "-import moment from 'moment';",
    "+import { format } from 'dateFns';",
    " export const x = 1;",
  ].join("\n");

  it("keys the pattern on what the fix REMOVED and the absent-marker on what it ADDED", () => {
    const seed = mineSensorSeedFromDiff(FIX_DIFF, ["src/dates.ts"]);
    expect(seed).not.toBeNull();
    expect(seed!.pattern).toBe("moment");        // removed-only token = the mistake
    expect(seed!.absent).toBe("dateFns");        // added-only token = the correct marker
  });

  it("ignores files outside the lesson's anchor paths", () => {
    expect(mineSensorSeedFromDiff(FIX_DIFF, ["src/other/"])).toBeNull();
  });

  it("returns null when the fix removed nothing distinctive", () => {
    const diff = "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1,2 @@\n x\n+// a comment\n";
    expect(mineSensorSeedFromDiff(diff, ["src/a.ts"])).toBeNull();
  });
});

describe("suggestSensorSeed — never suggests the recommended fix as the pattern", () => {
  it("does not pick the `Instead, use:` tool even when it leaks into the why-failed line", () => {
    // Regression: `--instead date-fns` where why-failed says "team standard is date-fns" used to seed
    // pattern=`date-fns` — a sensor firing on the CORRECT replacement. The recommended token must be
    // excluded; with no faulty code-shaped token left, returning null (author it yourself) is correct.
    const body = [
      "# importing moment.js",
      "",
      "**Why it failed / do NOT use:** bundle bloat — team standard is date-fns",
      "",
      "**Instead, use:** date-fns",
    ].join("\n");
    const seed = suggestSensorSeed(body, ["src/dates.ts"]);
    expect(seed?.pattern).not.toBe("date-fns");
    expect(seed).toBeNull();
  });
});

describe("suggestSensorSeed — non-persisted candidate for propose_sensor", () => {
  it("returns a bare seed (pattern/absent/message/paths) with no live-sensor fields", () => {
    const body = [
      "# Called stripe.paymentIntents.create without an idempotencyKey option",
      "",
      "**Why it failed / do NOT use:** A retried request double-charged the customer.",
      "",
      "**Instead, use:** Always pass { idempotencyKey } to paymentIntents.create",
    ].join("\n");
    const seed = suggestSensorSeed(body, ["src/payments/stripe.ts"]);
    expect(seed?.pattern).toContain("paymentIntents");
    expect(seed?.absent).toBe("idempotencyKey");
    expect(seed?.paths).toEqual(["src/payments/stripe.ts"]);
    expect(seed?.message).toMatch(/without idempotencyKey/);
    // A seed is NOT a Sensor: it must not carry severity/autogen/kind/last_fired.
    expect(seed as Record<string, unknown>).not.toHaveProperty("severity");
    expect(seed as Record<string, unknown>).not.toHaveProperty("autogen");
    expect(seed as Record<string, unknown>).not.toHaveProperty("kind");
  });

  it("returns null when no anchor paths are given", () => {
    expect(suggestSensorSeed("# No BigInt\n\n`BigInt` broke serialization.", [])).toBeNull();
  });
});

describe("suggestSensorFromMemory", () => {
  it("suggests a conservative warn regex sensor for anchored attempts", () => {
    const body = [
      "# BigInt broke serialization",
      "",
      "**Why it failed / do NOT use:** `BigInt` broke JSON serialization in math.ts.",
      "",
      "**Instead, use:** Decimal strings at API boundaries.",
      "",
    ].join("\n");

    const sensor = suggestSensorFromMemory(body, ["src/math.ts"]);
    expect(sensor).toMatchObject({
      kind: "regex",
      pattern: "BigInt",
      paths: ["src/math.ts"],
      severity: "warn",
      autogen: true,
      last_fired: null,
    });
    expect(sensor?.message).toContain("Decimal strings");
  });

  it("returns null when the memory is anchorless or too generic", () => {
    expect(suggestSensorFromMemory("Always keep code simple.", [])).toBeNull();
    expect(suggestSensorFromMemory("Always keep code simple.", ["src/app.ts"])).toBeNull();
  });

  it("prefers assignment values over broad keys", () => {
    const sensor = suggestSensorFromMemory(
      "# open-in-view\n\n`open-in-view=true` is the bad setting. Keep `open-in-view=false`.",
      ["src/app.properties"],
    );

    expect(sensor?.pattern).toBe("open-in-view\\s*=\\s*[\"']?true[\"']?");
    expect(sensor?.pattern).not.toBe("open-in-view");
  });

  it("captures quoted assignment values", () => {
    const sensor = suggestSensorFromMemory(
      "# Status literals\n\nDo not write status = \"KO\" in this path; use the enum helper.",
      ["src/status.ts"],
    );

    expect(sensor?.pattern).toBe("status\\s*=\\s*[\"']?KO[\"']?");
  });

  it("turns lowercase field/value phrasing into a scoped assignment sensor", () => {
    const sensor = suggestSensorFromMemory(
      "# using lowercase status ok\n\n**Why it failed / do NOT use:** Downstream integrations compare exact uppercase OK/KO values; using lowercase status ok failed.",
      ["src/status.ts"],
    );

    expect(sensor?.pattern).toBe("status\\s*[:=]\\s*[\"']?ok[\"']?");
  });

  it("never builds a degenerate sensor from line refs / numeric ranges / filenames", () => {
    // Reproduced real miss: a gotcha body referencing enforce.ts:1131-1186 produced a nonsensical
    // regex `enforce\.ts\s*:\s*1131-1186`. Such a sensor fires on noise → must be rejected.
    const lineRef = suggestSensorFromMemory(
      "# Gate path\n\nThe leak is in enforce.ts:1131-1186 where runPrecommitPolicy lives.",
      ["packages/cli/src/commands/enforce.ts"],
    );
    expect(lineRef?.pattern).not.toMatch(/1131-1186/);
    expect(lineRef?.pattern).not.toMatch(/enforce\\\.ts/);

    // A body that has ONLY a filename + line numbers yields no usable token → null, not garbage.
    expect(
      suggestSensorFromMemory("# Note\n\nSee config.json line 42 and 1131-1186.", ["a.ts"]),
    ).toBeNull();
  });

  it("does not build a sensor from an incident's error output (dead-sensor class)", () => {
    // Real dead sensors came from error text, e.g. `CACError: Unknown` — a pattern that never
    // matches a real source diff. The error-word stopwords must reject the value.
    const sensor = suggestSensorFromMemory(
      "# vitest flag\n\n**Why it failed / do NOT use:** the run printed `CACError: Unknown option --runInBand`.",
      ["package.json"],
    );
    // Best outcome is no sensor at all; if one is built, it must not encode the error phrase.
    if (sensor) expect(sensor.pattern).not.toMatch(/Unknown/i);
    else expect(sensor).toBeNull();
  });
});

describe("suggestSensorFromMemory — discriminating (X without Y)", () => {
  it("emits pattern=trigger + absent=companion for 'create without idempotencyKey'", () => {
    const body = [
      "# Called stripe.paymentIntents.create without an idempotencyKey option",
      "",
      "**Why it failed / do NOT use:** A retried request created a second paymentIntent and double-charged the customer.",
      "",
      "**Instead, use:** Always pass { idempotencyKey } as the second arg to paymentIntents.create",
      "",
    ].join("\n");
    const sensor = suggestSensorFromMemory(body, ["src/payments/stripe.ts"]);
    expect(sensor?.pattern).toContain("paymentIntents");
    expect(sensor?.absent).toBe("idempotencyKey");
    expect(sensor?.severity).toBe("warn");
    expect(sensor?.message).toMatch(/without idempotencyKey/);
  });

  it("detects a 'must pass X' requirement in a gotcha body", () => {
    const body = [
      "# Stripe charges must pass an idempotencyKey",
      "",
      "Every stripe.paymentIntents.create MUST receive an idempotencyKey in options, or a retry double-charges.",
    ].join("\n");
    const sensor = suggestSensorFromMemory(body, ["src/payments/stripe.ts"]);
    expect(sensor?.absent).toBe("idempotencyKey");
  });

  it("keeps trigger=call when the companion token is LONGER than the call (no inverted sensor)", () => {
    // Regression: "createOrder without idempotencyKey". The companion (idempotencyKey, 14 chars) is
    // longer/more distinctive than the call (createOrder, 11 chars), so the plain distinctive-token
    // pick used to return the companion, collapse the companion branch, and emit `pattern=idempotencyKey`
    // — a sensor that fired on CORRECT usage with the self-contradictory message
    // "Avoid idempotencyKey; always pass idempotencyKey". The trigger must exclude the companion.
    const body = [
      "# calling createOrder without idempotencyKey",
      "",
      "**Why it failed / do NOT use:** duplicate orders on retry; createOrder must receive an idempotencyKey",
      "",
      "**Instead, use:** always pass idempotencyKey to createOrder",
    ].join("\n");
    const sensor = suggestSensorFromMemory(body, ["src/orders.ts"]);
    expect(sensor?.pattern).toBe("createOrder");
    expect(sensor?.absent).toBe("idempotencyKey");
    // The pattern must never BE the required companion (that is the inverted sensor).
    expect(sensor?.pattern).not.toBe("idempotencyKey");
    // And the message must not tell the reader to avoid the very thing they must always pass.
    expect(sensor?.message).not.toMatch(/avoid idempotencyKey/i);
  });

  it("never emits the tool's own name (Hivelore) lifted from auto-added provenance boilerplate", () => {
    // Regression: mem_save appends a "## Why\nRecorded in Hivelore …" provenance section. The generator
    // scanned it and picked "Hivelore" as the distinctive token, producing a sensor that only ever fires
    // on diffs mentioning Hivelore. The tool's own name must be a stopword; the real token wins instead.
    const body = [
      "# Avoid the legacyAdapter shim",
      "",
      "**Why it failed / do NOT use:** legacyAdapter breaks under load.",
      "",
      "## Why",
      "Recorded in Hivelore so future agents can apply this project rule consistently.",
    ].join("\n");
    const sensor = suggestSensorFromMemory(body, ["src/adapter.ts"]);
    expect(sensor?.pattern).toBe("legacyAdapter");
    expect(sensor?.pattern).not.toMatch(/haive/i);
  });

  it("treats a 'No X' title as avoid-X, not as a required-missing companion", () => {
    // Regression: "No BigInt" means avoid BigInt (X is the bad token), NOT "BigInt is required".
    // The ambiguous `no X` companion signal must not produce an inverted "<other> without BigInt" sensor.
    const body = "# No BigInt\n\n`BigInt` broke JSON serialization. **Instead, use:** Decimal strings.";
    const sensor = suggestSensorFromMemory(body, ["src/math.ts"]);
    expect(sensor?.pattern).toBe("BigInt");
    expect(sensor?.absent).toBeUndefined();
  });

  it("builds a word-bounded plain-trigger sensor when gated by a distinctive companion", () => {
    // "charge" is a plain verb (not code-shaped) so the strict pick yields nothing; but the companion
    // idempotencyKey is distinctive and gates the sensor, so a \bcharge\b + absent sensor is built.
    const body = [
      "# calling charge without idempotencyKey",
      "",
      "**Why it failed / do NOT use:** double charge on retry; must pass idempotencyKey",
      "",
      "**Instead, use:** always pass idempotencyKey to charge",
    ].join("\n");
    const s = suggestSensorFromMemory(body, ["src/billing.ts"]);
    expect(s?.pattern).toBe("\\bcharge\\b");
    expect(s?.absent).toBe("idempotencyKey");
  });

  it("emits NO sensor when BOTH the call and the companion are plain words", () => {
    // "token" is not distinctive, so there is no safe companion to gate the plain "charge" trigger.
    const body = "# calling charge without token\n\n**Why it failed / do NOT use:** x\n\n**Instead, use:** y";
    expect(suggestSensorFromMemory(body, ["src/billing.ts"])).toBeNull();
  });

  it("does not set absent when there is no required companion", () => {
    const body = [
      "# BigInt broke serialization",
      "",
      "**Why it failed / do NOT use:** `BigInt` broke JSON serialization.",
      "",
      "**Instead, use:** Decimal strings at API boundaries.",
    ].join("\n");
    const sensor = suggestSensorFromMemory(body, ["src/math.ts"]);
    expect(sensor?.pattern).toBe("BigInt");
    expect(sensor?.absent).toBeUndefined();
  });
});
