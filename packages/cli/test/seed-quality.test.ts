import { describe, expect, it } from "vitest";
import { meetsSeedQualityFloor, specificityScore, SEED_QUALITY_FLOOR } from "@hivelore/core";
import { PACKS } from "../src/commands/init-stack-packs.js";

/**
 * Quality guard for the SHIPPED stack-pack seed library. A coding agent already knows generic best
 * practice ("validate input", "use const"); seeding that is pure token overhead and erodes trust in
 * the corpus. Every seed we ship must clear the floor: it carries a sensor (enforceable) OR is a
 * concrete, non-generic trap. This test fails the build if anyone adds a low-value seed later — the
 * user's "no low-quality seeds" requirement, enforced.
 */
describe("stack-pack seed quality floor", () => {
  const all = Object.entries(PACKS).flatMap(([stack, mems]) =>
    mems.map((m) => ({ stack, slug: m.slug, body: m.body, hasSensor: Boolean(m.sensor) })),
  );

  it("ships a non-trivial seed library", () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it("every shipped seed clears the quality floor (sensor OR concrete & non-generic)", () => {
    const failures = all
      .filter((m) => !meetsSeedQualityFloor(m.body, m.hasSensor))
      .map((m) => `${m.stack}/${m.slug} (specificity ${specificityScore(m.body).toFixed(2)}, sensor=${m.hasSensor})`);
    expect(
      failures,
      `These seeds are below the quality floor (${SEED_QUALITY_FLOOR}). Add a sensor, make them concrete, or drop them:\n${failures.join("\n")}`,
    ).toEqual([]);
  });
});
