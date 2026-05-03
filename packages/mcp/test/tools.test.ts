import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { bootstrapProjectSave } from "../src/tools/bootstrap-project-save.js";
import { getProjectContext } from "../src/tools/get-project-context.js";
import { getBriefing } from "../src/tools/get-briefing.js";
import { memList } from "../src/tools/mem-list.js";
import { memSave } from "../src/tools/mem-save.js";
import { memSearch } from "../src/tools/mem-search.js";
import { memSessionEnd } from "../src/tools/mem-session-end.js";
import { pendingDistillPath, type PendingDistill } from "../src/session-tracker.js";

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

  describe("pending distill (Phase 2)", () => {
    it("get_briefing surfaces action_required when pending-distill.json exists", async () => {
      // Simulate what SessionTracker writes at shutdown
      const cacheDir = path.join(ctx.paths.haiveDir, ".cache");
      await mkdir(cacheDir, { recursive: true });
      const payload: PendingDistill = {
        session_start: new Date(Date.now() - 30 * 60_000).toISOString(),
        session_end: new Date(Date.now() - 5 * 60_000).toISOString(),
        total_tool_calls: 12,
        tool_summary: "get_briefing ×2, mem_save ×1",
        memories_saved: ["2026-05-03-gotcha-xyz"],
        git_diff_available: false,
      };
      await writeFile(pendingDistillPath(ctx), JSON.stringify(payload), "utf8");

      const briefing = await getBriefing(
        { task: "fix a bug", files: [], max_tokens: 4000, max_memories: 5,
          include_project_context: false, include_module_contexts: false,
          semantic: false, include_stale: false, track: false, format: "full",
          symbols: [], min_semantic_score: 0 },
        ctx,
      );

      const distillItem = briefing.action_required.find(
        (a) => a.id === "__pending_distill__",
      );
      expect(distillItem).toBeDefined();
      expect(distillItem!.summary).toContain("undistilled learnings");
      expect(distillItem!.developer_message).toContain("post_task");
      expect(distillItem!.developer_message).toContain("12 tool calls");
    });

    it("mem_session_end clears the pending-distill marker", async () => {
      const cacheDir = path.join(ctx.paths.haiveDir, ".cache");
      await mkdir(cacheDir, { recursive: true });
      const payload: PendingDistill = {
        session_start: new Date().toISOString(),
        session_end: new Date().toISOString(),
        total_tool_calls: 5,
        tool_summary: "get_briefing ×1",
        memories_saved: [],
        git_diff_available: false,
      };
      const markerPath = pendingDistillPath(ctx);
      await writeFile(markerPath, JSON.stringify(payload), "utf8");
      expect(existsSync(markerPath)).toBe(true);

      await memSessionEnd(
        { goal: "test session", accomplished: "done", discoveries: "",
          files_touched: [], next_steps: "", scope: "personal" },
        ctx,
      );

      expect(existsSync(markerPath)).toBe(false);
    });

    it("get_briefing auto-expires pending-distill older than 7 days", async () => {
      const cacheDir = path.join(ctx.paths.haiveDir, ".cache");
      await mkdir(cacheDir, { recursive: true });
      const old = new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString();
      const payload: PendingDistill = {
        session_start: old,
        session_end: old,
        total_tool_calls: 3,
        tool_summary: "get_briefing ×1",
        memories_saved: [],
        git_diff_available: false,
      };
      const markerPath = pendingDistillPath(ctx);
      await writeFile(markerPath, JSON.stringify(payload), "utf8");

      await getBriefing(
        { task: "anything", files: [], max_tokens: 4000, max_memories: 5,
          include_project_context: false, include_module_contexts: false,
          semantic: false, include_stale: false, track: false, format: "full",
          symbols: [], min_semantic_score: 0 },
        ctx,
      );

      // File should have been auto-deleted
      expect(existsSync(markerPath)).toBe(false);
    });
  });
});
