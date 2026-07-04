import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hivelore/core";
import type { HaiveContext } from "../src/context.js";
import { memTried } from "../src/tools/mem-tried.js";
import { detectTestFrameworkForPaths, scaffoldTest } from "../src/tools/scaffold-test.js";

describe("detectTestFrameworkForPaths — monorepo awareness", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "haive-detect-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("detects the framework of the package that owns the anchor path, not the repo root", async () => {
    // Root uses jest; a sub-package uses vitest.
    await writeFile(path.join(root, "package.json"), JSON.stringify({ devDependencies: { jest: "^29" } }), "utf8");
    await mkdir(path.join(root, "packages/api/src"), { recursive: true });
    await writeFile(path.join(root, "packages/api/package.json"), JSON.stringify({ devDependencies: { vitest: "^2" } }), "utf8");

    expect(await detectTestFrameworkForPaths(root, ["packages/api/src/pay.ts"])).toEqual({
      framework: "vitest",
      baseDir: "packages/api",
    });
    // A root-level anchor resolves to the root package (jest, no baseDir).
    expect(await detectTestFrameworkForPaths(root, ["scripts/"])).toEqual({ framework: "jest", baseDir: "" });
  });

  it("falls back to vitest at the root when nothing matches", async () => {
    expect(await detectTestFrameworkForPaths(root, [])).toEqual({ framework: "vitest", baseDir: "" });
  });
});

describe("scaffoldTest — MCP tool", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-scaffold-mcp-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.haiveDir, { recursive: true });
    // A sub-package with vitest that owns the incident.
    await mkdir(path.join(workDir, "packages/api/src"), { recursive: true });
    await writeFile(path.join(workDir, "packages/api/package.json"), JSON.stringify({ devDependencies: { vitest: "^2" } }), "utf8");
    ctx = { paths };
  });
  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function seedLesson(): Promise<string> {
    const out = await memTried(
      {
        what: "refund exceeded the captured amount",
        why_failed: "prod #442 — refunds must clamp to the capture",
        instead: "clamp the refund",
        scope: "team",
        tags: [],
        paths: ["packages/api/src/"],
      },
      ctx,
    );
    return out.id;
  }

  it("writes a pending test in the owning package and returns the wiring command, without arming", async () => {
    const id = await seedLesson();
    const res = await scaffoldTest({ memory_id: id, write: true }, ctx);

    expect(res.ok).toBe(true);
    expect(res.framework).toBe("vitest");
    expect(res.path).toBe(`packages/api/tests/incidents/${id.replace(/^\d{4}-\d{2}-\d{2}-attempt-/, "")}.test.ts`);
    expect(res.written).toBe(true);
    expect(res.propose_command).toContain("--kind test");
    expect(existsSync(path.join(workDir, res.path!))).toBe(true);

    const content = await readFile(path.join(workDir, res.path!), "utf8");
    expect(content).toContain("it.todo(");
    expect(content).toContain(id);

    // No sensor was armed on the memory frontmatter (propose_sensor stays the sole writer).
    const mem = await readFile(res.path ? path.join(workDir, ".ai/memories/team", `${id}.md`) : "", "utf8").catch(() => "");
    expect(mem).not.toContain("sensor:");
  });

  it("does not overwrite an existing file; write:false previews without writing", async () => {
    const id = await seedLesson();
    await scaffoldTest({ memory_id: id, write: true }, ctx);
    const again = await scaffoldTest({ memory_id: id, write: true }, ctx);
    expect(again.written).toBe(false);
    expect(again.already_exists).toBe(true);

    const preview = await scaffoldTest({ memory_id: id, write: false, out_path: "packages/api/tests/incidents/other.test.ts" }, ctx);
    expect(preview.written).toBe(false);
    expect(preview.content).toContain("it.todo(");
    expect(existsSync(path.join(workDir, "packages/api/tests/incidents/other.test.ts"))).toBe(false);
  });

  it("errors on an unknown memory id", async () => {
    const res = await scaffoldTest({ memory_id: "2099-01-01-attempt-nope", write: true }, ctx);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("No memory found");
  });
});

describe("scaffoldTest — multi-package lessons (one scaffold per owning package)", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-scaffold-multi-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.haiveDir, { recursive: true });
    await mkdir(path.join(workDir, "packages/api/src"), { recursive: true });
    await writeFile(path.join(workDir, "packages/api/package.json"), JSON.stringify({ devDependencies: { vitest: "^2" } }), "utf8");
    await mkdir(path.join(workDir, "packages/web/src"), { recursive: true });
    await writeFile(path.join(workDir, "packages/web/package.json"), JSON.stringify({ devDependencies: { jest: "^29" } }), "utf8");
    ctx = { paths };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("writes one pending test per owning package sharing ONE chained propose_command", async () => {
    const tried = await memTried(
      {
        what: "contract drift between api and web",
        why_failed: "the api response shape changed without the web mapper",
        scope: "team",
        tags: [],
        paths: ["packages/api/src/handler.ts", "packages/web/src/mapper.ts"],
      },
      ctx,
    );
    const out = await scaffoldTest({ memory_id: tried.id, framework: undefined, out_path: undefined, write: true }, ctx);
    expect(out.ok).toBe(true);
    expect(out.scaffolds).toHaveLength(2);
    const [api, web] = out.scaffolds!;
    expect(api!.path).toContain("packages/api/tests/incidents/");
    expect(api!.framework).toBe("vitest");
    expect(web!.path).toContain("packages/web/tests/incidents/");
    expect(web!.framework).toBe("jest");
    expect(api!.written).toBe(true);
    expect(web!.written).toBe(true);
    // ONE sensor arms them all: the proposal chains both run commands and scopes all anchors.
    expect(out.propose_command).toContain(api!.run_command);
    expect(out.propose_command).toContain(web!.run_command);
    expect(out.propose_command).toContain("&&");
    expect(out.propose_command).toContain("packages/api/src/handler.ts,packages/web/src/mapper.ts");
    // Every generated file embeds the SHARED propose command, not a per-file one.
    const apiContent = await readFile(path.join(workDir, api!.path), "utf8");
    expect(apiContent).toContain("&&");
    expect(out.notice).toMatch(/2 packages/);
  });

  it("keeps the single-package shape unchanged (no scaffolds array, per-file propose)", async () => {
    const tried = await memTried(
      {
        what: "api-only lesson",
        why_failed: "x",
        scope: "team",
        tags: [],
        paths: ["packages/api/src/handler.ts"],
      },
      ctx,
    );
    const out = await scaffoldTest({ memory_id: tried.id, framework: undefined, out_path: undefined, write: false }, ctx);
    expect(out.ok).toBe(true);
    expect(out.scaffolds).toBeUndefined();
    expect(out.propose_command).not.toContain("&&");
  });
});
