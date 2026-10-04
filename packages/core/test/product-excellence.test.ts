import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { findProjectRoot, resolveHaivePaths, buildFrontmatter } from "../src/index.js";
import { completeExcerpt } from "../src/compact-context.js";
import { recordProjectContextEmission, projectContextRecentlyEmitted, resetProjectContextEmission } from "../src/context-throttle.js";
import { verifyAnchor } from "../src/verifier.js";
import { recordKnowledgeOutcome, loadKnowledgeOutcomes, summarizeKnowledgeOutcomes } from "../src/outcomes.js";

describe("product excellence regressions", () => {
  it("resolves the repository above a nested package manifest, respecting a nested Git boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hivelore-root-"));
    try {
      await mkdir(path.join(root, ".ai")); await mkdir(path.join(root, "frontend"));
      await writeFile(path.join(root, "frontend/package.json"), "{}");
      expect(findProjectRoot(path.join(root, "frontend"))).toBe(root);
      await mkdir(path.join(root, "frontend/.git"));
      expect(findProjectRoot(path.join(root, "frontend"))).toBe(path.join(root, "frontend"));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("isolates context receipts and resets only the compacted session", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hivelore-context-"));
    try {
      const p = resolveHaivePaths(root), now = Date.now();
      await recordProjectContextEmission(p, "hash", now, "a");
      expect(await projectContextRecentlyEmitted(p, "hash", now, "b")).toBe(false);
      await recordProjectContextEmission(p, "hash", now, "b");
      await resetProjectContextEmission(p, "a");
      expect(await projectContextRecentlyEmitted(p, "hash", now, "a")).toBe(false);
      expect(await projectContextRecentlyEmitted(p, "hash", now, "b")).toBe(true);
      expect(await projectContextRecentlyEmitted(p, "hash", now - 1, "b")).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("never turns an oversized instruction into a partial rule", () => {
    expect(completeExcerpt("Never charge automatically unless a manager approves.", 20)).toBe("");
    expect(completeExcerpt("Use cents. Never charge automatically unless approved.", 20)).toBe("Use cents.");
  });
  it("verifies a Java class field structurally and rejects a removed member", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hivelore-symbol-"));
    try {
      const body = "class ServiceOffering { private String section; }";
      await writeFile(path.join(root, "ServiceOffering.java"), body);
      const memory = { frontmatter: buildFrontmatter({ type: "decision", slug: "field", paths: ["ServiceOffering.java"], symbols: ["ServiceOffering.section"] }), body: "Keep sections." };
      const verification = await verifyAnchor(memory, { projectRoot: root });
      expect(verification.stale, JSON.stringify(verification)).toBe(false);
      await writeFile(path.join(root, "ServiceOffering.java"), "class ServiceOffering { /* section */ private String title; }");
      expect((await verifyAnchor(memory, { projectRoot: root })).stale).toBe(true);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("keeps observed delivery distinct from reported usefulness", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hivelore-outcome-"));
    try {
      const p = resolveHaivePaths(root);
      await recordKnowledgeOutcome(p, { id: "rule", kind: "exposed", source: "hook", evidence: "observed" });
      await recordKnowledgeOutcome(p, { id: "rule", kind: "rejected", source: "cli", evidence: "reported" });
      const summary = summarizeKnowledgeOutcomes(await loadKnowledgeOutcomes(p));
      expect(summary.by_memory.rule).toEqual({ exposed: 1, rejected: 1, applied: 0, corrected: 0, verified: 0 });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
