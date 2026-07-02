import { describe, expect, it } from "vitest";
import { antiPatternGateParams, DEFAULT_CONFIG, AUTOPILOT_DEFAULTS } from "../src/config.js";

describe("antiPatternGateParams", () => {
  it("maps each gate level to the correct pre_commit_check params", () => {
    expect(antiPatternGateParams("off")).toEqual({ block_on: "never", anchored_blocks: false });
    expect(antiPatternGateParams("review")).toEqual({ block_on: "high-confidence", anchored_blocks: false });
    expect(antiPatternGateParams("anchored")).toEqual({ block_on: "high-confidence", anchored_blocks: true });
    expect(antiPatternGateParams("strict")).toEqual({ block_on: "any", anchored_blocks: true });
  });

  it("defaults the gate to 'anchored' in both default and autopilot configs", () => {
    // The git hook and `hivelore precommit` both fall back to this when the field is unset.
    expect(DEFAULT_CONFIG.enforcement?.antiPatternGate).toBe("anchored");
    expect(AUTOPILOT_DEFAULTS.enforcement?.antiPatternGate).toBe("anchored");
  });
});
