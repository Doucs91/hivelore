import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadMemoriesFromDir, resolveHaivePaths } from "@hivelore/core";
import type { HaiveContext } from "../src/context.js";
import { getBriefing } from "../src/tools/get-briefing.js";
import { projectBriefingForAgent } from "../src/tools/briefing-agent-view.js";
import { memSessionEnd } from "../src/tools/mem-session-end.js";
import { shapeWarning } from "../src/tools/mem-save.js";

const baseInput = {
  max_tokens: 4000, max_memories: 8,
  include_project_context: false, include_module_contexts: false,
  semantic: false, include_stale: false, track: false,
  format: "full" as const, symbols: [] as string[], min_semantic_score: 0,
};

describe("0.67 — docs, evidence and local handoffs", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "hivelore-067-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.teamDir, { recursive: true });
    await writeFile(paths.projectContext, "# Project\n", "utf8");
    ctx = { paths };
  });
  afterEach(async () => { await rm(workDir, { recursive: true, force: true }); });

  it("surfaces a doc warning about a passed file, with its location (field report #9 §1)", async () => {
    await mkdir(path.join(workDir, "docs"), { recursive: true });
    await writeFile(path.join(workDir, "docs", "security.md"), [
      "# Security", "", "## CSP",
      "", "Tightening `config/csp.ts` to `worker-src 'self'` would break the PDF viewer in real browsers.", "",
    ].join("\n"), "utf8");
    const briefing = await getBriefing({ ...baseInput, task: "harden the CSP", files: ["config/csp.ts"] }, ctx);
    expect(briefing.doc_caveats?.[0]).toMatchObject({ doc: "docs/security.md", target: "config/csp.ts" });
    const view = projectBriefingForAgent(briefing, workDir);
    expect(view.docs?.caveats?.[0]?.at).toBe("docs/security.md:5");
    expect(view.docs?.caveats?.[0]?.text).toContain("would break the PDF viewer");
  });

  it("delivers what verified a memory and its blind spot next to the rule (field report #9 §9.3)", async () => {
    await writeFile(path.join(ctx.paths.teamDir, "2026-11-01-decision-enforce-csp.md"), [
      "---", "id: 2026-11-01-decision-enforce-csp", "scope: team", "type: decision", "status: validated",
      `created_at: ${new Date().toISOString()}`, "anchor:", "  paths: [\"config/csp.ts\"]", "  symbols: []", "tags: []",
      "rule: Keep the CSP in enforce mode; roll back by flipping CSP_REPORT_ONLY.",
      "verified_by: e2e suite (headless Chromium) + 7 days of CSP reports",
      "cannot_detect: GPU-only render paths; refusals inside web workers",
      "---", "# Enforce the CSP", "", "Body.",
    ].join("\n"), "utf8");
    const briefing = await getBriefing({ ...baseInput, task: "harden the CSP", files: ["config/csp.ts"] }, ctx);
    const memory = projectBriefingForAgent(briefing, workDir).memories.find((m) => m.id === "2026-11-01-decision-enforce-csp");
    expect(memory?.verified_by).toContain("headless Chromium");
    expect(memory?.blind_spot).toBe("GPU-only render paths; refusals inside web workers");
  });

  it("keeps a recap out of the shared corpus and unanchored", async () => {
    const out = await memSessionEnd(
      { goal: "ship csp", accomplished: "done", discoveries: "", files_touched: ["config/csp.ts"], next_steps: "", scope: "team" },
      ctx,
    );
    expect(out.scope).toBe("personal");
    expect(out.notice).toContain("never shared corpus");
    const recap = (await loadMemoriesFromDir(ctx.paths.memoriesDir)).find(({ memory }) => memory.frontmatter.type === "session_recap");
    expect(recap?.memory.frontmatter.anchor.paths).toEqual([]);
    expect(recap?.filePath).toContain(`${path.sep}personal${path.sep}`);
  });

  it("writes the local NEXT.md handoff when the repo opted out of recap memories", async () => {
    await writeFile(path.join(ctx.paths.haiveDir, "hivelore.config.json"), JSON.stringify({ autoSessionRecap: false, sessionHandoff: true }), "utf8");
    const out = await memSessionEnd(
      { goal: "finish the CSP rollout", accomplished: "enforced on staging", discoveries: "- pdf worker refused on GPU path",
        files_touched: [], next_steps: "enable in production", scope: "personal" },
      ctx,
    );
    expect(out.action).toBe("handoff");
    const handoff = await readFile(path.join(workDir, "NEXT.md"), "utf8");
    expect(handoff).toContain("finish the CSP rollout");
    expect(handoff).toContain("pdf worker refused on GPU path");
    expect(existsSync(ctx.paths.personalDir) ? (await loadMemoriesFromDir(ctx.paths.memoriesDir)).length : 0).toBe(0);
  });

  it("asks for the limits of a claimed proof at save time", () => {
    expect(shapeWarning("decision", "# D\n\nRule: keep it.", "keep it", "tested")).toContain("cannot_detect");
    expect(shapeWarning("decision", "# D\n\nRule: keep it.", "keep it", "tested", "unit tests", "nothing known")).toBeNull();
    expect(shapeWarning("decision", "# D\n\nRule: keep it.", "keep it")).toBeNull();
  });
});
