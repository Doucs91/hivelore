import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFrontmatter } from "../src/parser.js";
import { verifyAnchor } from "../src/verifier.js";
import type { Memory } from "../src/types.js";

function makeMemory(overrides: {
  paths?: string[];
  symbols?: string[];
  body?: string;
}): Memory {
  const fm = buildFrontmatter({
    type: "convention",
    slug: "x",
    paths: overrides.paths ?? [],
    symbols: overrides.symbols ?? [],
  });
  return { frontmatter: fm, body: overrides.body ?? "body" };
}

describe("verifyAnchor", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-verify-"));
    await mkdir(path.join(workDir, "src"), { recursive: true });
    await writeFile(
      path.join(workDir, "src", "alpha.ts"),
      "export function processPayment() {}\nexport const VERSION = 1;",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("treats anchorless memories as fresh", async () => {
    const m = makeMemory({});
    const result = await verifyAnchor(m, { projectRoot: workDir });
    expect(result.stale).toBe(false);
  });

  it("returns fresh when paths exist and symbols are present", async () => {
    const m = makeMemory({
      paths: ["src/alpha.ts"],
      symbols: ["processPayment"],
    });
    const result = await verifyAnchor(m, { projectRoot: workDir });
    expect(result.stale).toBe(false);
    expect(result.reason).toBeNull();
  });

  it("flags stale when an anchor path is missing", async () => {
    const m = makeMemory({
      paths: ["src/alpha.ts", "src/missing.ts"],
    });
    const result = await verifyAnchor(m, { projectRoot: workDir });
    expect(result.stale).toBe(true);
    expect(result.reason).toMatch(/no longer exist/);
    expect(result.reason).toContain("src/missing.ts");
  });

  it("flags stale when a symbol is no longer in any anchor path", async () => {
    const m = makeMemory({
      paths: ["src/alpha.ts"],
      symbols: ["processPayment", "ghostFunction"],
    });
    const result = await verifyAnchor(m, { projectRoot: workDir });
    expect(result.stale).toBe(true);
    expect(result.reason).toContain("ghostFunction");
    expect(result.reason).not.toContain("processPayment");
  });

  it("flags stale when symbols are recorded but no paths", async () => {
    const m = makeMemory({ symbols: ["x"] });
    const result = await verifyAnchor(m, { projectRoot: workDir });
    expect(result.stale).toBe(true);
    expect(result.reason).toMatch(/no anchor paths recorded/);
  });

  it("resolves absolute anchor paths verbatim", async () => {
    const abs = path.join(workDir, "src", "alpha.ts");
    const m = makeMemory({ paths: [abs] });
    const result = await verifyAnchor(m, { projectRoot: "/different/root" });
    expect(result.stale).toBe(false);
  });

  it("resolves glob anchor paths", async () => {
    const m = makeMemory({
      paths: ["src/*.ts"],
      symbols: ["processPayment"],
    });
    const result = await verifyAnchor(m, { projectRoot: workDir });
    expect(result.stale).toBe(false);
  });

  it("searches symbols inside directory anchors", async () => {
    const m = makeMemory({
      paths: ["src"],
      symbols: ["processPayment"],
    });
    const result = await verifyAnchor(m, { projectRoot: workDir });
    expect(result.stale).toBe(false);
  });
});
