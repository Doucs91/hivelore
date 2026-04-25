import { describe, expect, it } from "vitest";
import { cosine } from "../src/embedder.js";

describe("cosine", () => {
  it("returns 1.0 for identical vectors", () => {
    const a = new Float32Array([1, 2, 3]);
    expect(cosine(a, a)).toBeCloseTo(1.0, 6);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([0, 1]))).toBeCloseTo(0, 6);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosine(new Float32Array([1, 0]), new Float32Array([-1, 0]))).toBeCloseTo(-1, 6);
  });

  it("returns 0 when either vector is all zeros", () => {
    expect(cosine(new Float32Array([0, 0]), new Float32Array([1, 1]))).toBe(0);
  });

  it("throws on dimension mismatch", () => {
    expect(() => cosine(new Float32Array([1, 2]), new Float32Array([1, 2, 3]))).toThrow(
      /dimension mismatch/,
    );
  });

  it("works with plain number arrays", () => {
    expect(cosine([1, 2, 3], [1, 2, 3])).toBeCloseTo(1.0, 6);
  });
});
