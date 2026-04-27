import { describe, expect, it } from "vitest";
import {
  CHARS_PER_TOKEN,
  allocateBudget,
  estimateTokens,
  truncateToTokens,
} from "../src/token-budget.js";

describe("estimateTokens", () => {
  it("estimates ~1 token per CHARS_PER_TOKEN chars (rounded up)", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("x".repeat(CHARS_PER_TOKEN))).toBe(1);
    expect(estimateTokens("x".repeat(CHARS_PER_TOKEN * 5))).toBe(5);
    expect(estimateTokens("x".repeat(CHARS_PER_TOKEN + 1))).toBe(2);
  });
});

describe("truncateToTokens", () => {
  const longText = "abcdefghijklmnopqrstuvwxyz".repeat(20); // 520 chars

  it("returns input unchanged when under budget", () => {
    const r = truncateToTokens("short", { maxTokens: 100 });
    expect(r.truncated).toBe(false);
    expect(r.text).toBe("short");
  });

  it("truncates head mode (keeps the beginning)", () => {
    const r = truncateToTokens(longText, { maxTokens: 20, mode: "head" });
    expect(r.truncated).toBe(true);
    expect(r.text.startsWith("abcdef")).toBe(true);
    expect(r.estimatedTokens).toBeLessThanOrEqual(20);
  });

  it("truncates tail mode (keeps the end)", () => {
    const r = truncateToTokens(longText, { maxTokens: 20, mode: "tail" });
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith("xyz")).toBe(true);
  });

  it("middle mode keeps both ends", () => {
    const r = truncateToTokens(longText, { maxTokens: 30, mode: "middle" });
    expect(r.truncated).toBe(true);
    expect(r.text.startsWith("abc")).toBe(true);
    expect(r.text.endsWith("xyz")).toBe(true);
  });

  it("zero budget returns just the marker", () => {
    const r = truncateToTokens(longText, { maxTokens: 0 });
    expect(r.truncated).toBe(true);
    expect(r.estimatedTokens).toBe(0);
  });
});

describe("allocateBudget", () => {
  it("splits the budget proportionally to weights", () => {
    const slices = allocateBudget(
      [
        { key: "a", text: "x".repeat(400), weight: 3 },
        { key: "b", text: "x".repeat(400), weight: 1 },
      ],
      100,
    );
    expect(slices.length).toBe(2);
    const a = slices.find((s) => s.key === "a")!;
    const b = slices.find((s) => s.key === "b")!;
    expect(a.allocatedTokens).toBeGreaterThan(b.allocatedTokens);
  });

  it("redistributes surplus when one part is smaller than its share", () => {
    const slices = allocateBudget(
      [
        { key: "small", text: "x".repeat(20), weight: 1 },
        { key: "big", text: "x".repeat(2000), weight: 1 },
      ],
      100,
    );
    const small = slices.find((s) => s.key === "small")!;
    const big = slices.find((s) => s.key === "big")!;
    expect(small.truncated).toBe(false);
    expect(big.allocatedTokens).toBeGreaterThan(50);
  });

  it("zero parts returns empty array", () => {
    expect(allocateBudget([], 100)).toEqual([]);
  });

  it("zero total weight returns empty content", () => {
    const slices = allocateBudget(
      [{ key: "a", text: "abc", weight: 0 }],
      100,
    );
    expect(slices[0]!.text).toBe("");
  });
});
