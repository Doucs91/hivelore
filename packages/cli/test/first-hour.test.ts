import { execSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildFrontmatter,
  loadMemoriesFromDir,
  memoryFilePath,
  resolveHaivePaths,
  saveCodeMap,
  serializeMemory,
} from "@hivelore/core";
import { findDocFile } from "../src/utils/doc-files.js";
import { detectBridgeTargets } from "../src/utils/bridge-detect.js";
import { lintMemoriesAsync } from "../src/commands/memory-lint.js";

/**
 * First-hour experience guards — regressions here are the first thing a new user hits.
 * Field findings from testing the published package on express/vite clones:
 *  - init suggested `memory import README.md` (missing --from) against a repo whose file is Readme.md
 *  - the corpus auto-fix anchored generic stack-pack seeds to arbitrary files whose export
 *    names matched seed prose (a React useEffect gotcha → a docs data file on a non-React repo)
 *  - init dropped all 12 bridge files regardless of which clients exist
 */
describe("first-hour experience", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-firsthour-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe("findDocFile", () => {
    it("finds a readme regardless of casing (express ships Readme.md)", async () => {
      await writeFile(path.join(workDir, "Readme.md"), "# x", "utf8");
      expect(findDocFile(workDir, "readme")).toBe("Readme.md");
    });

    it("returns undefined when the doc does not exist", () => {
      expect(findDocFile(workDir, "changelog")).toBeUndefined();
    });

    it("does not match files that merely start with the stem", async () => {
      await writeFile(path.join(workDir, "CHANGELOG-archive.md"), "# x", "utf8");
      expect(findDocFile(workDir, "changelog")).toBeUndefined();
    });
  });

  describe("detectBridgeTargets", () => {
    it("always includes agents, and picks up clients from machine signals", async () => {
      const home = path.join(workDir, "home");
      await mkdir(path.join(home, ".claude"), { recursive: true });
      await mkdir(path.join(home, ".gemini"), { recursive: true });
      const det = detectBridgeTargets(workDir, {}, home);
      expect(det.targets).toContain("agents");
      expect(det.targets).toContain("claude");
      expect(det.targets).toContain("gemini");
      expect(det.targets).not.toContain("windsurf");
      expect(det.reasons.claude).toBe("installed");
    });

    it("keeps a target whose bridge file already exists in the repo", async () => {
      const home = path.join(workDir, "home-empty");
      await mkdir(home, { recursive: true });
      await writeFile(path.join(workDir, ".windsurfrules"), "existing", "utf8");
      const det = detectBridgeTargets(workDir, {}, home);
      expect(det.targets).toContain("windsurf");
      expect(det.reasons.windsurf).toBe("repo file");
    });

    it("detects the currently running agent from env", async () => {
      const home = path.join(workDir, "home-empty2");
      await mkdir(home, { recursive: true });
      const det = detectBridgeTargets(workDir, { CURSOR_AGENT: "1" }, home);
      expect(det.targets).toContain("cursor");
    });

    it("falls back to agents alone on a bare machine", async () => {
      const home = path.join(workDir, "home-bare");
      await mkdir(home, { recursive: true });
      const det = detectBridgeTargets(workDir, {}, home);
      expect(det.targets).toEqual(["agents"]);
    });
  });

  describe("stack-pack seeds are never auto-anchored", () => {
    it("lint --fix leaves a seed unanchored even when its prose matches a code-map export", async () => {
      const paths = resolveHaivePaths(workDir);
      await mkdir(paths.teamDir, { recursive: true });
      execSync("git init -q && git add -A", { cwd: workDir });
      // A file whose exported symbol appears verbatim in the seed body.
      await mkdir(path.join(workDir, "src"), { recursive: true });
      await writeFile(path.join(workDir, "src/util.ts"), "export function cleanup() {}", "utf8");
      execSync("git add -A", { cwd: workDir });
      await saveCodeMap(paths, {
        version: 1,
        generated_at: new Date().toISOString(),
        root: workDir,
        files: { "src/util.ts": { exports: [{ name: "cleanup", kind: "function", line: 1 }], loc: 1 } },
      });
      const seedFm = buildFrontmatter({
        type: "gotcha",
        slug: "react-useeffect-cleanup",
        scope: "team",
        status: "validated",
        tags: ["react", "stack-pack"],
      });
      const seedFile = memoryFilePath(paths, "team", seedFm.id);
      await writeFile(
        seedFile,
        serializeMemory({
          frontmatter: seedFm,
          body: "# React: cleanup\n\nuseEffect subscriptions need cleanup to avoid leaks.",
        }),
        "utf8",
      );

      const report = await lintMemoriesAsync(workDir, { fix: true, apply: true });
      const loaded = await loadMemoriesFromDir(paths.memoriesDir);
      const seed = loaded.find((m) => m.memory.frontmatter.id === seedFm.id);
      expect(seed?.memory.frontmatter.anchor.paths).toEqual([]);
      expect(report.findings.filter((f) => f.id === seedFm.id && f.code === "MISSING_ANCHOR")).toEqual([]);
    });

    it("still auto-anchors a normal (non-seed) memory the same way", async () => {
      const paths = resolveHaivePaths(workDir);
      await mkdir(paths.teamDir, { recursive: true });
      execSync("git init -q", { cwd: workDir });
      await mkdir(path.join(workDir, "src"), { recursive: true });
      await writeFile(path.join(workDir, "src/util.ts"), "export function cleanup() {}", "utf8");
      execSync("git add -A", { cwd: workDir });
      await saveCodeMap(paths, {
        version: 1,
        generated_at: new Date().toISOString(),
        root: workDir,
        files: { "src/util.ts": { exports: [{ name: "cleanup", kind: "function", line: 1 }], loc: 1 } },
      });
      const fm = buildFrontmatter({
        type: "gotcha",
        slug: "cleanup-must-run",
        scope: "team",
        status: "validated",
        tags: [],
      });
      await writeFile(
        memoryFilePath(paths, "team", fm.id),
        serializeMemory({ frontmatter: fm, body: "# Cleanup\n\nAlways call cleanup before rebinding." }),
        "utf8",
      );

      await lintMemoriesAsync(workDir, { fix: true, apply: true });
      const loaded = await loadMemoriesFromDir(paths.memoriesDir);
      const mem = loaded.find((m) => m.memory.frontmatter.id === fm.id);
      expect(mem?.memory.frontmatter.anchor.paths).toContain("src/util.ts");
    });
  });
});
