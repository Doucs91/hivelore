import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFrontmatter, parseMemory, serializeMemory } from "../src/parser.js";
import { verifyAnchor } from "../src/verifier.js";
import { supersededMemoryIds } from "../src/loader.js";
import { deriveConfidence, isAutoPromoteEligible } from "../src/confidence.js";
import { emptyUsage } from "../src/usage.js";

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
const memory = (id: string, supersedes: string[] = []) => ({ filePath: `${id}.md`, memory: {
  frontmatter: { ...buildFrontmatter({ type: "decision", slug: id, status: "validated", supersedes }), id }, body: "Current contract",
} });

describe("evidence grounded in current files", () => {
  it("detects a contradicted claim even when its historical migration still exists", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hivelore-evidence-")); dirs.push(root);
    await writeFile(path.join(root, "001.sql"), "CREATE TABLE old_name;");
    await writeFile(path.join(root, "schema.sql"), "CREATE TABLE current_name;");
    const m = memory("renamed").memory;
    m.frontmatter.anchor.paths = ["001.sql"];
    m.frontmatter.checks = [{ path: "schema.sql", contains: "CREATE TABLE old_name;" }];
    m.frontmatter.evidence = "tested";
    const parsed = parseMemory(serializeMemory(m));
    expect(parsed.frontmatter.checks).toEqual(m.frontmatter.checks);
    expect((await verifyAnchor(parsed, { projectRoot: root })).stale).toBe(true);
    parsed.frontmatter.checks = [{ path: "schema.sql", contains: "current_name", excludes: "old_name" }];
    expect((await verifyAnchor(parsed, { projectRoot: root })).stale).toBe(false);
  });

  it("does not follow check paths through a symlink outside the project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hivelore-check-")); dirs.push(root);
    const outside = await mkdtemp(path.join(tmpdir(), "hivelore-outside-")); dirs.push(outside);
    await writeFile(path.join(outside, "external"), "visible");
    await symlink(path.join(outside, "external"), path.join(root, "link"));
    const m = memory("external").memory;
    m.frontmatter.checks = [{ path: "link", contains: "visible" }];
    expect((await verifyAnchor(m, { projectRoot: root })).stale).toBe(true);
  });

  it("retains both sides of ambiguous supersession cycles and ignores hypotheses", () => {
    expect([...supersededMemoryIds([memory("a", ["b"]), memory("b", ["a"])])]).toEqual([]);
    expect([...supersededMemoryIds([memory("a"), memory("b", ["a"])])]).toEqual(["a"]);
    const hypothesis = memory("b", ["a"]); hypothesis.memory.frontmatter.evidence = "hypothesis";
    expect([...supersededMemoryIds([memory("a"), hypothesis])]).toEqual([]);
    expect(deriveConfidence(hypothesis.memory.frontmatter, { ...emptyUsage(), read_count: 1000 })).toBe("low");
    hypothesis.memory.frontmatter.status = "proposed";
    expect(isAutoPromoteEligible(hypothesis.memory.frontmatter, { ...emptyUsage(), applied_count: 100 })).toBe(false);
  });
});
