import { describe, expect, it } from "vitest";
import { specificityScore, isLikelyGuessable } from "../src/specificity.js";

describe("specificityScore", () => {
  it("scores arbitrary, team-specific rules high", () => {
    const publicId = "PUBLIC ID FORMAT — public ids are the internal id plus an offset of 100000, prefixed with 'AC-'. Example: internalId 7 -> 'AC-100007', 42 -> 'AC-100042'.";
    const status = "Every JSON response's 'status' field is the string 'OK' on success or 'KO' on failure. Never use 'success'/'error'.";
    expect(specificityScore(publicId)).toBeGreaterThan(0.5);
    expect(specificityScore(status)).toBeGreaterThan(0.5);
    expect(isLikelyGuessable(publicId)).toBe(false);
    expect(isLikelyGuessable(status)).toBe(false);
  });

  it("scores generic best-practice prose low", () => {
    const generic1 = "Always validate input and handle errors. Write tests and use meaningful names.";
    const generic2 = "Never commit secrets to the repository. Use environment variables for configuration.";
    expect(specificityScore(generic1)).toBeLessThan(0.3);
    expect(specificityScore(generic2)).toBeLessThan(0.3);
    expect(isLikelyGuessable(generic1)).toBe(true);
    expect(isLikelyGuessable(generic2)).toBe(true);
  });

  it("ranks the unguessable rule above the generic one", () => {
    const arbitrary = "Tenant ids must be base32 and prefixed with 'tnt_'; the legacy column is `org_id`.";
    const generic = "Make sure to validate input and avoid sql injection.";
    expect(specificityScore(arbitrary)).toBeGreaterThan(specificityScore(generic));
  });

  it("handles empty input", () => {
    expect(specificityScore("")).toBe(0);
    expect(specificityScore("   ")).toBe(0);
  });
});
