import { describe, expect, it } from "vitest";
import { parseMemory } from "../src/parser.js";
import {
  extractSnippet,
  literalMatchesAllTokens,
  pickSnippetNeedle,
  tokenizeQuery,
} from "../src/search.js";

const memory = parseMemory(`---
id: 2026-04-25-gotcha-tsup-externals-required
type: gotcha
status: validated
tags: [build, tsup]
created_at: 2026-04-25T10:00:00.000Z
---

Without explicit 'external' in tsup.config.ts, tsup will inline cross-package
dependencies, exploding the CLI bundle to >5MB.`);

describe("tokenizeQuery", () => {
  it("splits on whitespace, lowercases, drops empties", () => {
    expect(tokenizeQuery("  Tsup External  ")).toEqual(["tsup", "external"]);
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("\t  ")).toEqual([]);
  });
});

describe("literalMatchesAllTokens", () => {
  it("returns true when all tokens are found across id/tags/body", () => {
    expect(literalMatchesAllTokens(memory, ["tsup", "external"])).toBe(true);
  });

  it("returns true when tokens hit different fields (id + body)", () => {
    expect(literalMatchesAllTokens(memory, ["gotcha", "external"])).toBe(true);
  });

  it("returns false when any single token is absent", () => {
    expect(literalMatchesAllTokens(memory, ["tsup", "nonexistent"])).toBe(false);
  });

  it("returns true on empty token list (matches everything)", () => {
    expect(literalMatchesAllTokens(memory, [])).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(literalMatchesAllTokens(memory, ["TSUP", "External"])).toBe(true);
  });
});

describe("pickSnippetNeedle", () => {
  it("returns the longest token", () => {
    expect(pickSnippetNeedle("tsup external")).toBe("external");
  });

  it("falls back to lowercased query when empty", () => {
    expect(pickSnippetNeedle("")).toBe("");
  });
});

describe("extractSnippet", () => {
  it("returns context around the needle and trails with …", () => {
    const snippet = extractSnippet(memory.body, "external", 20);
    expect(snippet).toContain("external");
    expect(snippet.endsWith("…")).toBe(true);
  });

  it("prefixes with … when there is text before the window", () => {
    const longBody = "padding ".repeat(20) + "needle in the haystack";
    const snippet = extractSnippet(longBody, "needle", 10);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet).toContain("needle");
  });

  it("falls back to a head slice when needle missing", () => {
    const snippet = extractSnippet(memory.body, "zzz");
    expect(snippet.length).toBeGreaterThan(0);
    expect(snippet).not.toContain("zzz");
  });
});
