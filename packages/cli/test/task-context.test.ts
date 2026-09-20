import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHaivePaths, buildFrontmatter, serializeMemory, readSessionBriefingMarker, writeBriefingMarker } from "@hivelore/core";
import { gitText, startTaskSession, worktreeSnapshot, taskDirtyFiles, changedSince, loadTaskSession } from "../src/utils/task-session.js";
import { injectFileContext } from "../src/utils/file-context.js";
import { exactRenames, repairRenamedAnchors } from "../src/utils/rename-anchors.js";

let root: string;
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
async function finish(mode: string, sessionId: string) {
  try {
    const result = await promisify(execFile)(process.execPath, [cli, "enforce", "finish", "--mode", mode, "--session-id", sessionId, "--json", "--dir", root]);
    return JSON.parse(result.stdout);
  } catch (error) {
    return JSON.parse((error as { stdout: string }).stdout);
  }
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "hivelore-task-"));
  await gitText(root, ["init", "-b", "main"]);
  await gitText(root, ["config", "user.email", "test@example.com"]);
  await gitText(root, ["config", "user.name", "Test"]);
  await writeFile(path.join(root, ".gitignore"), ".ai/.runtime/\n.ai/.usage/\n.ai/.cache/\n");
  await writeFile(path.join(root, "source with spaces.ts"), "original\n");
  await gitText(root, ["add", "."]);
  await gitText(root, ["commit", "-m", "fixture"]);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("task attribution and passive file context", () => {
  it("consultation coverage requires active policy, not deliberately excluded context", async () => {
    const paths = resolveHaivePaths(root);
    await mkdir(paths.teamDir, { recursive: true });
    await writeFile(path.join(paths.haiveDir, "hivelore.config.json"), JSON.stringify({ autopilot: false,
      briefingExcludeTags: ["hidden"], enforcement: { mode: "strict", requireDecisionCoverage: true, autoBrief: false } }));
    const active = buildFrontmatter({ type: "decision", slug: "active-policy", scope: "team", status: "validated", paths: ["source with spaces.ts"] });
    const hidden = buildFrontmatter({ type: "decision", slug: "hidden-policy", scope: "team", status: "validated", paths: ["source with spaces.ts"], tags: ["hidden"] });
    for (const fm of [active, hidden]) await writeFile(path.join(paths.teamDir, `${fm.id}.md`), serializeMemory({ frontmatter: fm, body: "Keep the transaction boundary." }));
    await gitText(root, ["add", "."]); await gitText(root, ["commit", "-m", "policies"]);
    await writeFile(path.join(root, "source with spaces.ts"), "updated\n");
    await gitText(root, ["add", "source with spaces.ts"]);
    await writeBriefingMarker(paths, { task: "edit transaction handling", source: "test", memoryIds: [] });
    const result = await promisify(execFile)(process.execPath, [cli, "enforce", "check", "--stage", "pre-commit", "--json", "--dir", root],
      { env: { ...process.env, HIVELORE_AGENT: "1" } }).catch(error => ({ stdout: error.stdout as string }));
    const finding = JSON.parse(result.stdout).findings.find((f: { code: string }) => f.code === "decision-coverage-missing");
    expect(finding, result.stdout).toBeDefined();
    expect(finding.memory_ids).toEqual([active.id]);
  });
  it("keeps explicitly required integrations mandatory and accepts the latest successful run", async () => {
    const paths = resolveHaivePaths(root);
    await mkdir(paths.haiveDir, { recursive: true });
    await writeFile(path.join(paths.haiveDir, "hivelore.config.json"), JSON.stringify({ autopilot: false,
      enforcement: { mode: "strict", requiredCiWorkflows: ["SonarQube"] } }));
    await gitText(root, ["add", "."]); await gitText(root, ["commit", "-m", "config"]);
    await gitText(root, ["remote", "add", "origin", "https://github.com/example/fixture.git"]);
    await gitText(root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
    await gitText(root, ["config", "branch.main.remote", "origin"]);
    await gitText(root, ["config", "branch.main.merge", "refs/heads/main"]);
    const bin = path.join(paths.haiveDir, ".cache", "bin"); await mkdir(bin, { recursive: true });
    const fixture = path.join(bin, "runs.json");
    const gh = path.join(bin, "gh");
    await writeFile(gh, `#!/usr/bin/env node\nconst fs = require('node:fs'); process.stdout.write(fs.readFileSync(${JSON.stringify(fixture)}, 'utf8'));\n`);
    await chmod(gh, 0o755);
    vi.stubEnv("PATH", `${bin}${path.delimiter}${process.env.PATH}`);
    const core = { name: "CI", workflowName: "CI", databaseId: 1, status: "completed", conclusion: "success" };
    const failed = { name: "SonarQube", workflowName: "SonarQube", databaseId: 2, status: "completed", conclusion: "failure" };
    await writeFile(fixture, JSON.stringify([core]));
    expect((await finish("release", "ci")).findings.some((f: { code: string }) => f.code === "github-actions-required-missing")).toBe(true);
    await writeFile(fixture, JSON.stringify([core, failed]));
    expect((await finish("release", "ci")).should_block).toBe(true);
    await writeFile(fixture, JSON.stringify([core, failed, { ...failed, databaseId: 3, conclusion: "success" }]));
    expect((await finish("release", "ci")).should_block).toBe(false);
  });
  it("read completion needs a baseline and rejects edits; local completion accepts an uncommitted fix", async () => {
    const paths = resolveHaivePaths(root);
    await mkdir(paths.haiveDir, { recursive: true });
    await writeFile(path.join(paths.haiveDir, "hivelore.config.json"), JSON.stringify({ autopilot: false, enforcement: { mode: "strict" } }));
    expect((await finish("read", "no-baseline")).findings.some((f: { code: string }) => f.code === "task-baseline-required")).toBe(true);
    await startTaskSession(paths, "read", "read");
    expect((await finish("read", "read")).should_block).toBe(false);
    await writeFile(path.join(root, "source with spaces.ts"), "fixed\n");
    expect((await finish("read", "read")).should_block).toBe(true);
    const local = await finish("local", "read");
    expect(local.should_block).toBe(false);
    expect(local.findings.some((f: { code: string }) => f.code === "local-completion")).toBe(true);
    expect((await finish("commit", "read")).should_block).toBe(true);
  });
  it("excludes unchanged pre-existing work but owns subsequent edits to the same file", async () => {
    const paths = resolveHaivePaths(root);
    await writeFile(path.join(root, "source with spaces.ts"), "colleague change\n");
    await writeFile(path.join(root, "client feedback.md"), "client text\n");
    const task = await startTaskSession(paths, "task", "local");
    expect(taskDirtyFiles(task, await worktreeSnapshot(root))).toEqual([]);
    await writeFile(path.join(root, "source with spaces.ts"), "colleague change plus my fix\n");
    expect(taskDirtyFiles(task, await worktreeSnapshot(root))).toEqual(["source with spaces.ts"]);
    expect(await readFile(path.join(root, "client feedback.md"), "utf8")).toBe("client text\n");
    expect((await loadTaskSession(paths, "task"))?.mode).toBe("local");
  });

  it("detects file effects of scripts whose names contain no target path", async () => {
    const paths = resolveHaivePaths(root);
    const task = await startTaskSession(paths, "script");
    // Same effect as an opaque build/patch script: detect from Git, not command parsing.
    await writeFile(path.join(root, "created.ts"), "export const value = 1;\n");
    expect(changedSince(task.observed, await worktreeSnapshot(root))).toEqual(["created.ts"]);
  });

  it("parses rename destinations with spaces and observes staged changes", async () => {
    const paths = resolveHaivePaths(root);
    const task = await startTaskSession(paths, "rename");
    await gitText(root, ["mv", "source with spaces.ts", "renamed file.ts"]);
    expect(taskDirtyFiles(task, await worktreeSnapshot(root))).toEqual(["renamed file.ts"]);
  });

  it("repairs exact rename anchors without staging memory changes or touching edited memories", async () => {
    const paths = resolveHaivePaths(root);
    await mkdir(paths.teamDir, { recursive: true });
    const fm = buildFrontmatter({ type: "gotcha", slug: "rename-policy", scope: "team", paths: ["source with spaces.ts"] });
    const file = path.join(paths.teamDir, `${fm.id}.md`);
    await writeFile(file, serializeMemory({ frontmatter: fm, body: "Keep this rule after moving the file." }));
    await gitText(root, ["add", "."]);
    await gitText(root, ["commit", "-m", "policy"]);
    await gitText(root, ["mv", "source with spaces.ts", "renamed file.ts"]);
    expect(await repairRenamedAnchors(paths, true)).toEqual([fm.id]);
    expect(await readFile(file, "utf8")).toContain("source with spaces.ts");
    expect(await repairRenamedAnchors(paths)).toEqual([fm.id]);
    expect(await readFile(file, "utf8")).toContain("renamed file.ts");
    expect(await gitText(root, ["diff", "--cached", "--name-only"])).not.toContain(".md");
    expect(exactRenames("R095\0old.ts\0new.ts\0").size).toBe(0);
  });

  it("is quiet without useful context, then delivers each policy once per session", async () => {
    const paths = resolveHaivePaths(root);
    await mkdir(paths.teamDir, { recursive: true });
    expect(await injectFileContext(paths, ["unrelated.ts"], "one")).toBeNull();
    const fm = buildFrontmatter({ type: "gotcha", slug: "actual-policy", status: "validated", scope: "team", paths: ["source with spaces.ts"] });
    await writeFile(path.join(paths.teamDir, `${fm.id}.md`), serializeMemory({ frontmatter: fm, body: "Use the transaction wrapper for writes." }));
    const first = await injectFileContext(paths, ["source with spaces.ts"], "one");
    expect(first).toContain("Use the transaction wrapper");
    expect(await injectFileContext(paths, ["source with spaces.ts"], "one")).toBeNull();
    expect(await injectFileContext(paths, ["source with spaces.ts"], "two")).toContain("Use the transaction wrapper");
    expect((await readSessionBriefingMarker(paths, "one"))?.memory_ids).toEqual([fm.id]);
  });
});
