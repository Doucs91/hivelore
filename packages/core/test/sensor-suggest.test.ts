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
});
