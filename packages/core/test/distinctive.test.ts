import { describe, expect, it } from "vitest";
import {
  buildDocFrequency,
  diffHasDistinctiveOverlap,
  distinctiveCap,
  isDistinctiveToken,
  tokenizeWords,
} from "../src/distinctive.js";

describe("tokenizeWords", () => {
  it("keeps >=4-char tokens and drops code stopwords", () => {
    const toks = tokenizeWords("export const handleScopeValue = bigint(open)");
    expect(toks).toContain("handlescopevalue");
    expect(toks).toContain("bigint");
    expect(toks).toContain("open");
    expect(toks).not.toContain("const"); // stopword
    expect(toks).not.toContain("the"); // <4 (n/a) — sanity
  });
});

describe("document frequency + distinctiveness", () => {
  const corpus = [
    "BigInt broke JSON serialization — do not use BigInt in the math module.",
    "The scope was overridden by defaultScope in the memory module.",
    "serializeMemory crashes on undefined values in the memory frontmatter.",
    "The memory scope resolution reads defaultScope from config.",
  ];
  const freq = buildDocFrequency(corpus);

  it("common words across the corpus are NOT distinctive", () => {
    // "memory" appears in 3/4 docs, "scope" in 2/4 — common.
    expect(isDistinctiveToken("memory", freq)).toBe(false);
    expect(isDistinctiveToken("scope", freq)).toBe(false);
  });

  it("rare words ARE distinctive", () => {
    // "bigint" appears in 1/4 docs.
    expect(isDistinctiveToken("bigint", freq)).toBe(true);
    // a token not in the corpus at all is distinctive
    expect(isDistinctiveToken("open-in-view".replace(/-/g, ""), freq)).toBe(true);
  });

  it("distinctiveCap scales with corpus but floors at 1 (strict = rare)", () => {
    expect(distinctiveCap(1)).toBe(1);
    expect(distinctiveCap(4)).toBe(1);
    expect(distinctiveCap(40)).toBe(4);
  });
});

describe("diffHasDistinctiveOverlap", () => {
  const corpus = [
    "BigInt broke JSON serialization — do not use BigInt.",
    "The scope was overridden by defaultScope in memory save.",
    "serializeMemory crashes on undefined in memory frontmatter.",
    "memory scope resolution and defaultScope handling.",
  ];
  const freq = buildDocFrequency(corpus);
  const bigintMemory = corpus[0]!;
  const scopeMemory = corpus[1]!;

  it("true when the diff reintroduces a distinctive token", () => {
    expect(diffHasDistinctiveOverlap("+ const x = BigInt(a) + BigInt(b);", bigintMemory, freq)).toBe(true);
  });

  it("false when the diff shares only common domain words", () => {
    // The diff mentions "memory" and "scope" (common) but nothing distinctive to the scope gotcha.
    expect(diffHasDistinctiveOverlap("+ activation: input.activation, // skill memory scope", scopeMemory, freq)).toBe(false);
  });

  it("false for an empty memory body", () => {
    expect(diffHasDistinctiveOverlap("+ BigInt(a)", "", freq)).toBe(false);
  });
});
