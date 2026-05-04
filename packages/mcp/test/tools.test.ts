import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import { patternDetect } from "../src/tools/pattern-detect.js";
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

  describe("inline auto-promote in get_briefing (Phase 4)", () => {
    it("promotes after 1 read when config autoPromoteMinReads=1", async () => {
      // Autopilot-style config: promote immediately on first read
      await writeFile(
        path.join(ctx.paths.haiveDir, "haive.config.json"),
        JSON.stringify({ autoPromoteMinReads: 1 }),
        "utf8",
      );
      const saved = await memSave(
        {
          type: "convention",
          slug: "fast-promote",
          body: "Should promote after just one briefing read.",
          scope: "team",
          tags: ["test"],
          paths: [],
        },
        ctx,
      );
      // Force status to proposed
      const { loadMemoriesFromDir, serializeMemory } = await import("@hiveai/core");
      const mems = await loadMemoriesFromDir(ctx.paths.memoriesDir);
      const target = mems.find((m) => m.memory.frontmatter.id === saved.id);
      expect(target).toBeDefined();
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(
        target!.filePath,
        serializeMemory({
          frontmatter: { ...target!.memory.frontmatter, status: "proposed" },
          body: target!.memory.body,
        }),
        "utf8",
      );
      // A single get_briefing should be enough to promote it
      await getBriefing(
        {
          task: "fast-promote convention test",
          files: [],
          max_tokens: 4000,
          max_memories: 10,
          include_project_context: false,
          include_module_contexts: false,
          semantic: false,
          include_stale: false,
          track: true,
          format: "full",
          symbols: [],
          min_semantic_score: 0,
        },
        ctx,
      );
      const afterMems = await loadMemoriesFromDir(ctx.paths.memoriesDir);
      const promoted = afterMems.find((m) => m.memory.frontmatter.id === saved.id);
      expect(promoted?.memory.frontmatter.status).toBe("validated");
    });

    it("promotes a proposed memory to validated once read_count >= minReads (5)", async () => {
      // Save a proposed memory
      const saved = await memSave(
        {
          type: "convention",
          slug: "auto-promote-me",
          body: "This should auto-promote after 5 reads.",
          scope: "team",
          tags: ["test"],
          paths: [],
          topic: undefined,
          symbols: undefined,
          author: undefined,
        },
        ctx,
      );
      // Manually force status to proposed
      const { loadMemoriesFromDir, serializeMemory } = await import("@hiveai/core");
      const mems = await loadMemoriesFromDir(ctx.paths.memoriesDir);
      const target = mems.find((m) => m.memory.frontmatter.id === saved.id);
      expect(target).toBeDefined();
      const { writeFile: wf } = await import("node:fs/promises");
      await wf(
        target!.filePath,
        serializeMemory({
          frontmatter: { ...target!.memory.frontmatter, status: "proposed" },
          body: target!.memory.body,
        }),
        "utf8",
      );

      // Run get_briefing 5 times — each call increments read_count
      const briefingOpts = {
        task: "auto-promote-me convention test",
        files: [],
        max_tokens: 4000,
        max_memories: 10,
        include_project_context: false,
        include_module_contexts: false,
        semantic: false,
        include_stale: false,
        track: true,
        format: "full" as const,
        symbols: [],
        min_semantic_score: 0,
      };
      for (let i = 0; i < 5; i++) {
        await getBriefing(briefingOpts, ctx);
      }

      // The memory should now be validated on disk
      const afterMems = await loadMemoriesFromDir(ctx.paths.memoriesDir);
      const promoted = afterMems.find((m) => m.memory.frontmatter.id === saved.id);
      expect(promoted?.memory.frontmatter.status).toBe("validated");
    });
  });

  describe("mem_save scope resolution", () => {
    it("respects explicit scope:personal even when config defaultScope is team", async () => {
      // Write a config that would normally force team scope
      await writeFile(
        path.join(ctx.paths.haiveDir, "haive.config.json"),
        JSON.stringify({ defaultScope: "team" }),
        "utf8",
      );
      const out = await memSave(
        {
          type: "convention",
          slug: "explicit-personal",
          body: "This is a personal note and should stay personal.",
          scope: "personal",
          tags: [],
          paths: [],
          symbols: [],
        },
        ctx,
      );
      expect(out.scope).toBe("personal");
      expect(out.file_path).toContain("/memories/personal/");
    });

    it("falls back to config defaultScope when scope is not provided", async () => {
      await writeFile(
        path.join(ctx.paths.haiveDir, "haive.config.json"),
        JSON.stringify({ defaultScope: "team" }),
        "utf8",
      );
      const out = await memSave(
        {
          type: "convention",
          slug: "team-default",
          body: "This should go to team because of defaultScope config.",
          // scope intentionally omitted
          tags: [],
          paths: [],
          symbols: [],
        },
        ctx,
      );
      expect(out.scope).toBe("team");
      expect(out.file_path).toContain("/memories/team/");
    });
  });

  describe("pattern_detect (Phase 3)", () => {
    it("returns empty result when no usage events exist", async () => {
      const out = await patternDetect(
        { since_days: 7, dry_run: true, scope: "team" },
        ctx,
      );
      expect(out.scanned_events).toBe(0);
      expect(out.matches).toHaveLength(0);
      expect(out.saved).toBe(0);
      expect(out.notice).toBeDefined();
    });

    it("produces distinct slugs for same-named files in different directories", async () => {
      // Simulate git repo with two vitest.config.ts files that were recently changed.
      // The slug must include the parent directory to avoid collision.
      // Since we can't run real git in tests, we call patternDetect with dry_run
      // and verify the slug-building logic indirectly by checking that the output
      // slug for "cli/vitest.config.ts" differs from "core/vitest.config.ts".
      // We do this by calling the exported slug helper logic directly via the matches.
      const usageDir = path.join(ctx.paths.haiveDir, ".usage");
      await mkdir(usageDir, { recursive: true });
      const events = [
        { at: new Date().toISOString(), tool: "mem_save", summary: "packages/cli/vitest.config.ts" },
        { at: new Date().toISOString(), tool: "mem_save", summary: "packages/cli/vitest.config.ts" },
        { at: new Date().toISOString(), tool: "mem_save", summary: "packages/cli/vitest.config.ts" },
        { at: new Date().toISOString(), tool: "mem_save", summary: "packages/core/vitest.config.ts" },
        { at: new Date().toISOString(), tool: "mem_save", summary: "packages/core/vitest.config.ts" },
        { at: new Date().toISOString(), tool: "mem_save", summary: "packages/core/vitest.config.ts" },
      ];
      await writeFile(
        path.join(usageDir, "tool-usage.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        "utf8",
      );
      // In dry_run mode we get all matches without writing files
      const result = await patternDetect(
        { since_days: 1, dry_run: false, scope: "team" },
        ctx,
      );
      // Both files should produce separate matches (different slugs)
      const hotFileSlugs = result.matches
        .filter((m) => m.kind === "hot_file")
        .map((m) => m.proposed_slug);
      // No two slugs should be identical
      const uniqueSlugs = new Set(hotFileSlugs);
      expect(uniqueSlugs.size).toBe(hotFileSlugs.length);
    });

    it("detects HOT_FILE signal and saves proposed memory", async () => {
      // Simulate usage events referencing same file 3+ times
      const usageDir = path.join(ctx.paths.haiveDir, ".usage");
      await mkdir(usageDir, { recursive: true });
      const events = [
        { at: new Date().toISOString(), tool: "mem_save", summary: "src/service.ts" },
        { at: new Date().toISOString(), tool: "mem_save", summary: "src/service.ts" },
        { at: new Date().toISOString(), tool: "mem_save", summary: "src/service.ts" },
      ];
      await writeFile(
        path.join(usageDir, "tool-usage.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
        "utf8",
      );

      const dry = await patternDetect(
        { since_days: 1, dry_run: true, scope: "team" },
        ctx,
      );
      expect(dry.matches.some((m) => m.kind === "hot_file")).toBe(true);
      expect(dry.saved).toBe(0); // dry_run

      const live = await patternDetect(
        { since_days: 1, dry_run: false, scope: "team" },
        ctx,
      );
      expect(live.saved).toBeGreaterThan(0);
      // Proposed memory should exist on disk
      const teamFiles = await readdir(ctx.paths.teamDir);
      expect(teamFiles.length).toBeGreaterThan(0);
    });
  });
});
