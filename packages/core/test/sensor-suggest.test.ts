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
});
