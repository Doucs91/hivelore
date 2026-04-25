import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@haive/core";
import type { HaiveContext } from "../src/context.js";
import { bootstrapProjectSave } from "../src/tools/bootstrap-project-save.js";
import { getProjectContext } from "../src/tools/get-project-context.js";
import { memList } from "../src/tools/mem-list.js";
import { memSave } from "../src/tools/mem-save.js";
import { memSearch } from "../src/tools/mem-search.js";

describe("hAIve MCP tools", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-mcp-test-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.personalDir, { recursive: true });
    await mkdir(paths.teamDir, { recursive: true });
    await mkdir(paths.moduleDir, { recursive: true });
    await mkdir(paths.modulesContextDir, { recursive: true });
    ctx = { paths };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  describe("mem_save", () => {
    it("creates a personal memory by default", async () => {
      const out = await memSave(
        {
          type: "convention",
          slug: "use-pnpm",
          body: "Always use pnpm.",
          scope: "personal",
          tags: [],
          paths: [],
          symbols: [],
        },
        ctx,
      );
      expect(out.scope).toBe("personal");
      expect(out.id).toMatch(/-convention-use-pnpm$/);
      const written = await readFile(out.file_path, "utf8");
      expect(written).toContain("Always use pnpm.");
      expect(written).toContain("scope: personal");
    });

    it("creates a team memory when scope=team", async () => {
      const out = await memSave(
        {
          type: "decision",
          slug: "no-lodash",
          body: "Decided: no lodash.",
          scope: "team",
          tags: ["dependencies"],
          paths: [],
          symbols: [],
        },
        ctx,
      );
      expect(out.scope).toBe("team");
      expect(out.file_path).toContain("/memories/team/");
    });

    it("rejects when .ai/ does not exist", async () => {
      const emptyCtx: HaiveContext = { paths: resolveHaivePaths(path.join(workDir, "missing")) };
      await expect(
        memSave(
          {
            type: "convention",
            slug: "x",
            body: "y",
            scope: "personal",
            tags: [],
            paths: [],
            symbols: [],
          },
          emptyCtx,
        ),
      ).rejects.toThrow(/No \.ai\/ directory/);
    });
  });

  describe("mem_search & mem_list", () => {
    beforeEach(async () => {
      await memSave(
        {
          type: "convention",
          slug: "use-pnpm",
          body: "Always use pnpm in this project.",
          scope: "personal",
          tags: ["tooling"],
          paths: [],
          symbols: [],
        },
        ctx,
      );
      await memSave(
        {
          type: "decision",
          slug: "no-lodash",
          body: "Decided to drop lodash.",
          scope: "team",
          tags: ["dependencies"],
          paths: [],
          symbols: [],
        },
        ctx,
      );
    });

    it("mem_search finds by tag substring", async () => {
      const result = await memSearch({ query: "tooling", limit: 20 }, ctx);
      expect(result.matches.length).toBe(1);
      expect(result.matches[0]!.id).toContain("use-pnpm");
      expect(result.matches[0]!.snippet).toContain("pnpm");
    });

    it("mem_search filters by scope", async () => {
      const result = await memSearch(
        { query: "pnpm", scope: "team", limit: 20 },
        ctx,
      );
      expect(result.matches.length).toBe(0);
    });

    it("mem_list returns all memories with no filters", async () => {
      const { memories } = await memList({}, ctx);
      expect(memories.length).toBe(2);
    });

    it("mem_list filters by type", async () => {
      const { memories } = await memList({ type: "decision" }, ctx);
      expect(memories.length).toBe(1);
      expect(memories[0]!.id).toContain("no-lodash");
    });
  });

  describe("get_project_context", () => {
    it("returns null when no project-context.md", async () => {
      const out = await getProjectContext({ list_modules: false }, ctx);
      expect(out.root_context).toBeNull();
    });

    it("returns root context content when present", async () => {
      await writeFile(ctx.paths.projectContext, "# hello", "utf8");
      const out = await getProjectContext({ list_modules: false }, ctx);
      expect(out.root_context).toBe("# hello");
    });

    it("includes module context when requested", async () => {
      const modDir = path.join(ctx.paths.modulesContextDir, "transactions");
      await mkdir(modDir, { recursive: true });
      await writeFile(path.join(modDir, "context.md"), "# transactions", "utf8");
      const out = await getProjectContext(
        { module: "transactions", list_modules: false },
        ctx,
      );
      expect(out.module_context?.name).toBe("transactions");
      expect(out.module_context?.content).toBe("# transactions");
    });

    it("lists available modules when requested", async () => {
      await mkdir(path.join(ctx.paths.modulesContextDir, "a"), { recursive: true });
      await mkdir(path.join(ctx.paths.modulesContextDir, "b"), { recursive: true });
      const out = await getProjectContext({ list_modules: true }, ctx);
      expect(out.available_modules).toEqual(["a", "b"]);
    });
  });

  describe("bootstrap_project_save", () => {
    it("creates the root project-context.md", async () => {
      const out = await bootstrapProjectSave(
        { content: "# Project\n\nHello.", overwrite: false },
        ctx,
      );
      expect(out.action).toBe("created");
      expect(out.file_path).toBe(ctx.paths.projectContext);
      const written = await readFile(ctx.paths.projectContext, "utf8");
      expect(written).toContain("Hello.");
    });

    it("refuses to overwrite without overwrite=true", async () => {
      await writeFile(ctx.paths.projectContext, "old", "utf8");
      await expect(
        bootstrapProjectSave({ content: "new", overwrite: false }, ctx),
      ).rejects.toThrow(/already exists/);
    });

    it("overwrites when overwrite=true", async () => {
      await writeFile(ctx.paths.projectContext, "old", "utf8");
      const out = await bootstrapProjectSave(
        { content: "new", overwrite: true },
        ctx,
      );
      expect(out.action).toBe("overwritten");
      const written = await readFile(ctx.paths.projectContext, "utf8");
      expect(written).toBe("new");
    });

    it("writes module context under .ai/modules/<name>/context.md", async () => {
      const out = await bootstrapProjectSave(
        { content: "# transactions", module: "transactions", overwrite: false },
        ctx,
      );
      expect(out.file_path).toContain("/modules/transactions/context.md");
      const written = await readFile(out.file_path, "utf8");
      expect(written).toBe("# transactions");
    });
  });
});
