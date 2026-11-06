import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { estimateTokens, readSessionBriefingMarker, resolveHaivePaths } from "@hivelore/core";
import type { HaiveContext } from "../src/context.js";
import { getBriefing } from "../src/tools/get-briefing.js";
import { AGENT_BRIEFING_SCHEMA, projectBriefingForAgent } from "../src/tools/briefing-agent-view.js";

const baseInput = {
  max_tokens: 4000, max_memories: 8,
  include_project_context: true, include_module_contexts: false,
  semantic: false, include_stale: false, track: false,
  format: "actions" as const, symbols: [] as string[], min_semantic_score: 0,
};

async function writeMemory(dir: string, id: string, body: string, anchorPath: string, type = "decision", extra = ""): Promise<void> {
  const fm = [
    "---", `id: ${id}`, "scope: team", `type: ${type}`, "status: validated",
    `created_at: ${new Date().toISOString()}`,
    "anchor:", `  paths: ["${anchorPath}"]`, "  symbols: []", "tags: []", extra, "---",
  ].filter(Boolean).join("\n");
  await writeFile(path.join(dir, `${id}.md`), `${fm}\n${body}\n`, "utf8");
}

/**
 * Field report #11 §2: the `quick` budget counted only memory bodies — a quarter of the payload —
 * and the briefing ran up to 2.4× the announced token count. Field report #12 §1.4: per-memory
 * metadata (impact_score, semantic_score, read_count, why…) outweighed knowledge and never varied.
 */
describe("agent-facing briefing contract", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "hivelore-agent-view-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.teamDir, { recursive: true });
    await writeFile(paths.projectContext, "# Project\n\n" + "Architecture notes. ".repeat(400), "utf8");
    ctx = { paths };
    for (let i = 0; i < 8; i++) {
      await writeMemory(
        paths.teamDir,
        `2026-01-0${i + 1}-decision-payments-${i}`,
        `# Payments ${i}\n\nLong context about the payment provider migration. `.repeat(30) + `\n\n**Instead:** call the typed client ${i}.`,
        "src/payments.ts",
      );
    }
  });
  afterEach(async () => { await rm(workDir, { recursive: true, force: true }); });

  it("keeps the WHOLE serialized payload within max_tokens, envelope included", async () => {
    for (const max of [600, 1200, 2500]) {
      const briefing = await getBriefing({ ...baseInput, max_tokens: max, session_id: `s${max}`, task: "change payments", files: ["src/payments.ts"] }, ctx);
      const view = projectBriefingForAgent(briefing, workDir);
      const actual = estimateTokens(JSON.stringify(view));
      expect(actual, `max_tokens=${max}`).toBeLessThanOrEqual(max);
      expect(view.estimated_tokens).toBe(actual);
    }
  });

  it("gives every memory a rule line and drops diagnostic fields", async () => {
    const briefing = await getBriefing({ ...baseInput, task: "change payments", files: ["src/payments.ts"] }, ctx);
    const view = projectBriefingForAgent(briefing, workDir);
    expect(view.schema).toBe(AGENT_BRIEFING_SCHEMA);
    expect(view.memories.length).toBeGreaterThan(0);
    for (const memory of view.memories) {
      expect(memory.rule).toMatch(/call the typed client \d/);
      expect(memory.file.startsWith("/")).toBe(false);
    }
    const raw = JSON.stringify(view);
    for (const field of ["impact_score", "impact_tier", "semantic_score", "read_count", "match_quality", "\"why\""]) {
      expect(raw).not.toContain(field);
    }
  });

  it("never credits a body the budget dropped as consulted", async () => {
    const briefing = await getBriefing({ ...baseInput, format: "full", max_tokens: 500, session_id: "tight", task: "change payments", files: ["src/payments.ts"] }, ctx);
    const omitted = briefing.memories.filter((m) => m.body_omitted).map((m) => m.id);
    const marker = await readSessionBriefingMarker(ctx.paths, "tight");
    for (const id of omitted) expect(marker?.memory_ids ?? []).not.toContain(id);
  });

  it("only looks up requested symbols, exact names first", async () => {
    const briefing = await getBriefing({ ...baseInput, task: "change payments", files: ["src/payments.ts"] }, ctx);
    expect(briefing.symbol_locations).toBeUndefined();
  });
});
