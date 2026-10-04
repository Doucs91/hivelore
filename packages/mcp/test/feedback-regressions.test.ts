import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveHaivePaths, buildFrontmatter, serializeMemory, loadUsageIndex } from "@hivelore/core";
import { getBriefing } from "../src/tools/get-briefing.js";
import { memGet } from "../src/tools/mem-get.js";
import { createHaiveServer } from "../src/server.js";
import { SessionTracker } from "../src/session-tracker.js";
import type { HaiveContext } from "../src/context.js";

let ctx: HaiveContext;
const input = { task: "change transaction handling", files: ["service.ts"], max_tokens: 1000, max_memories: 5,
  include_project_context: true, include_module_contexts: false, semantic: false, include_stale: false,
  track: true, format: "full" as const, symbols: [], min_semantic_score: 0, dedupe_project_context: false };
beforeEach(async () => {
  const root = await mkdtemp(path.join(tmpdir(), "hivelore-feedback-"));
  ctx = { paths: resolveHaivePaths(root) };
  await mkdir(ctx.paths.teamDir, { recursive: true });
  await writeFile(path.join(root, "service.ts"), "export const currentContract = true;\n");
});
afterEach(async () => { await rm(ctx.paths.root, { recursive: true, force: true }); });

async function save(slug: string, body: string, extra = {}) {
  const fm = { ...buildFrontmatter({ type: "decision", slug, scope: "team", status: "validated", paths: ["service.ts"] }), ...extra };
  await writeFile(path.join(ctx.paths.teamDir, `${fm.id}.md`), serializeMemory({ frontmatter: fm, body }));
  return fm.id;
}

describe("client feedback regressions", () => {
  it("restores context after a reset without leaking deduplication between sessions", async () => {
    await writeFile(ctx.paths.projectContext, "# Architecture\nUse the transaction wrapper.");
    const opts = { ...input, dedupe_project_context: true };
    expect((await getBriefing({ ...opts, session_id: "a" }, ctx)).project_context?.content).toContain("Use the transaction wrapper.");
    expect((await getBriefing({ ...opts, session_id: "a" }, ctx)).project_context).toMatchObject({ omitted_recent: true });
    expect((await getBriefing({ ...opts, session_id: "b" }, ctx)).project_context?.content).toContain("Use the transaction wrapper.");
    expect((await getBriefing({ ...opts, session_id: "a", context_reset: true }, ctx)).project_context?.content).toContain("Use the transaction wrapper.");
  });

  it("keeps negative feedback local instead of rewriting a shared rule", async () => {
    const { memFeedback } = await import("../src/tools/mem-feedback.js");
    const id = await save("feedback", "Use currentContract.");
    const file = path.join(ctx.paths.teamDir, `${id}.md`);
    const original = await readFile(file, "utf8");
    for (let i = 0; i < 5; i++) await memFeedback({ id, outcome: "rejected", reason: "Needs review" }, ctx);
    expect(await readFile(file, "utf8")).toBe(original);
  });

  it("records a tool call once through central registration, including explicit reads", async () => {
    const id = await save("logged", "Use currentContract.");
    const record = vi.spyOn(SessionTracker.prototype, "record").mockImplementation(() => {});
    try {
      const { server } = createHaiveServer({ root: ctx.paths.root });
      const registered = (server as unknown as { _registeredTools: Record<string, { handler: (input: unknown) => Promise<unknown> }> })._registeredTools;
      await registered.mem_get!.handler({ id });
      expect(record).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith("mem_get", id);
      expect((await loadUsageIndex(ctx.paths)).by_id[id]?.read_count).toBe(1);
      await server.close();
    } finally { record.mockRestore(); }
  });

  it("shares a small budget across policies instead of giving it to one long body", async () => {
    await writeFile(ctx.paths.projectContext, "# Architecture\n" + "Large historical overview. ".repeat(2000));
    const first = await save("long", "Use the transaction wrapper.\n" + "A long rationale. ".repeat(3000));
    const second = await save("short", "Never reuse a transaction after rollback.");
    const b = await getBriefing(input, ctx);
    expect(b.memories.map(m => m.id)).toEqual(expect.arrayContaining([first, second]));
    expect(b.memories.find(m => m.id === second)?.body).toContain("Never reuse");
    expect(b.memories.find(m => m.id === first)!.body.length).toBeLessThan(4000);
    expect(b.estimated_tokens).toBeLessThanOrEqual(input.max_tokens);
  });

  it("excludes a contradicted claim, without letting it supersede the valid current claim", async () => {
    const current = await save("current", "Use currentContract for transaction handling.");
    const wrong = await save("wrong", "Use oldContract for transaction handling.", {
      supersedes: [current], evidence: "tested", checks: [{ path: "service.ts", contains: "oldContract" }],
    });
    const b = await getBriefing(input, ctx);
    expect(b.memories.map(m => m.id)).toContain(current);
    expect(b.memories.map(m => m.id)).not.toContain(wrong);
    expect(b.setup_warnings.join(" ")).toContain(wrong);
    const usage = await loadUsageIndex(ctx.paths);
    expect(usage.by_id[wrong]).toBeUndefined();
    expect((await memGet({ id: wrong }, ctx)).checks).toEqual([{ path: "service.ts", contains: "oldContract" }]);
    expect((await loadUsageIndex(ctx.paths)).by_id[wrong]?.read_count).toBe(1);
  });

  it("keeps explicit human approval separate from housekeeping notices", async () => {
    const id = await save("approval", "Ask the developer before changing the transaction contract.", { requires_human_approval: true });
    const b = await getBriefing(input, ctx);
    expect(b.action_required.some(item => item.id === id)).toBe(true);
  });
});
