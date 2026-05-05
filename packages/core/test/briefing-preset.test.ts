import { describe, expect, it } from "vitest";
import { resolveBriefingBudget, BRIEFING_PRESET_DEFAULTS } from "../src/briefing-preset.js";

describe("resolveBriefingBudget", () => {
  const base = { max_tokens: 9999, max_memories: 99, include_module_contexts: false };

  it("passes overrides through when preset is absent", () => {
    expect(resolveBriefingBudget(undefined, base)).toEqual(base);
  });

  it("maps quick preset", () => {
    expect(resolveBriefingBudget("quick", base)).toEqual(BRIEFING_PRESET_DEFAULTS.quick);
  });

  it("deep increases limits vs balanced", () => {
    const d = BRIEFING_PRESET_DEFAULTS.deep;
    const b = BRIEFING_PRESET_DEFAULTS.balanced;
    expect(d.max_tokens).toBeGreaterThan(b.max_tokens);
    expect(d.max_memories).toBeGreaterThan(b.max_memories);
  });
});
