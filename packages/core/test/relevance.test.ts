import { describe, expect, it } from "vitest";
import { buildFrontmatter } from "../src/parser.js";
import {
  inferModulesFromPaths,
  memoryMatchesAnchorPaths,
  pathsOverlap,
} from "../src/relevance.js";
import type { Memory } from "../src/types.js";

function memoryWithPaths(paths: string[]): Memory {
  return {
    frontmatter: buildFrontmatter({ type: "convention", slug: "x", paths }),
    body: "",
  };
}

describe("inferModulesFromPaths", () => {
  it("extracts package names from packages/<name>/...", () => {
    expect(
      inferModulesFromPaths([
        "packages/core/src/parser.ts",
        "packages/cli/src/commands/init.ts",
      ]),
    ).toEqual(["cli", "core"]);
  });

  it("extracts module names from src/<name>/... and apps/<name>/...", () => {
    expect(
      inferModulesFromPaths([
        "src/transactions/Tx.ts",
        "apps/web/page.tsx",
        "modules/billing/index.ts",
      ]),
    ).toEqual(["billing", "transactions", "web"]);
  });

  it("returns empty array when no path matches a known pattern", () => {
    expect(inferModulesFromPaths(["README.md", "package.json"])).toEqual([]);
  });

  it("normalizes backslashes (Windows-style paths)", () => {
    expect(inferModulesFromPaths(["packages\\core\\src\\index.ts"])).toEqual(["core"]);
  });
});

describe("pathsOverlap", () => {
  it("true for identical paths", () => {
    expect(pathsOverlap("a/b/c", "a/b/c")).toBe(true);
  });

  it("true when one is a parent of the other", () => {
    expect(pathsOverlap("packages/core", "packages/core/src/parser.ts")).toBe(true);
    expect(pathsOverlap("packages/core/src/parser.ts", "packages/core")).toBe(true);
  });

  it("false for sibling paths sharing a prefix only as substring", () => {
    expect(pathsOverlap("packages/cli", "packages/cli-extra")).toBe(false);
  });

  it("false for unrelated paths", () => {
    expect(pathsOverlap("packages/core", "packages/cli")).toBe(false);
  });

  it("ignores leading ./ and trailing /", () => {
    expect(pathsOverlap("./packages/core/", "packages/core/src")).toBe(true);
  });

  it("supports glob anchors", () => {
    expect(pathsOverlap("packages/*/src/**/*.ts", "packages/core/src/parser.ts")).toBe(true);
    expect(pathsOverlap("packages/*/src/**/*.ts", "packages/core/test/parser.test.ts")).toBe(false);
  });

  it("treats a directory as overlapping a glob below it", () => {
    expect(pathsOverlap("packages/core", "packages/core/src/**/*.ts")).toBe(true);
  });
});

describe("memoryMatchesAnchorPaths", () => {
  it("matches when anchor path is a parent of input path", () => {
    const m = memoryWithPaths(["packages/core"]);
    expect(memoryMatchesAnchorPaths(m, ["packages/core/src/parser.ts"])).toBe(true);
  });

  it("matches when input path is a parent of anchor path", () => {
    const m = memoryWithPaths(["packages/core/src/parser.ts"]);
    expect(memoryMatchesAnchorPaths(m, ["packages/core"])).toBe(true);
  });

  it("does not match anchorless memories", () => {
    const m = memoryWithPaths([]);
    expect(memoryMatchesAnchorPaths(m, ["packages/core"])).toBe(false);
  });

  it("does not match unrelated paths", () => {
    const m = memoryWithPaths(["packages/cli"]);
    expect(memoryMatchesAnchorPaths(m, ["packages/core"])).toBe(false);
  });

  it("matches glob anchor paths", () => {
    const m = memoryWithPaths(["packages/*/src/**/*.ts"]);
    expect(memoryMatchesAnchorPaths(m, ["packages/core/src/parser.ts"])).toBe(true);
  });
});
