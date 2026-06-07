import { describe, expect, it } from "vitest";
import { suggestSensorFromMemory } from "../src/sensor-suggest.js";

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

  it("never emits the tool's own name (hAIve) lifted from auto-added provenance boilerplate", () => {
    // Regression: mem_save appends a "## Why\nRecorded in hAIve …" provenance section. The generator
    // scanned it and picked "hAIve" as the distinctive token, producing a sensor that only ever fires
    // on diffs mentioning hAIve. The tool's own name must be a stopword; the real token wins instead.
    const body = [
      "# Avoid the legacyAdapter shim",
      "",
      "**Why it failed / do NOT use:** legacyAdapter breaks under load.",
      "",
      "## Why",
      "Recorded in hAIve so future agents can apply this project rule consistently.",
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
