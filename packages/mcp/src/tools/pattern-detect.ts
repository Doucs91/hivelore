/**
 * pattern_detect — heuristic memory detector that runs without an LLM.
 *
 * Three signals (no LLM required):
 *   1. CONFIG_CHANGE: git diff shows changes to config files
 *      (tsconfig, eslint, prettier, vitest, .env.example, …)
 *      → proposes a convention memory with the diff as body.
 *
 *   2. REPEATED_PATH: same file path appears in ≥ N consecutive mem_tried /
 *      mem_observe events in the usage log
 *      → proposes a gotcha memory anchored to that path.
 *
 *   3. HOT_FILE: a non-config source file appears in mem_save / mem_tried /
 *      mem_observe summaries ≥ 3 times in the look-back window
 *      → proposes a convention memory (frequent edits signal a pattern).
 *
 * Output is `status: proposed` — auto-promote (Phase 4) or the next
 * get_briefing post_task flow will validate/reject them.
 *
 * Runs entirely from the local filesystem: git, usage log, no network.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import {
  buildFrontmatter,
  memoryFilePath,
  readUsageEvents,
  serializeMemory,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

// ── Constants ──────────────────────────────────────────────────────────────

/** Glob patterns (lowercased) that identify config files. */
const CONFIG_PATTERNS = [
  ".eslintrc", "eslint.config", "prettier.config", ".prettierrc",
  "tsconfig", "jsconfig",
  "vitest.config", "jest.config",
  ".env.example", ".env.defaults",
  "tailwind.config", "vite.config", "next.config",
  "babel.config", "postcss.config",
  "renovate.json", "dependabot.yml",
];

/** Max length of a git diff included in a proposed memory body. */
const MAX_DIFF_BYTES = 4096;

/** Threshold: path must appear this many times to trigger a HOT_FILE signal. */
const HOT_FILE_MIN = 3;

// ── Input / Output ─────────────────────────────────────────────────────────

export const PatternDetectInputSchema = {
  since_days: z
    .number()
    .int()
    .min(1)
    .default(7)
    .describe("Look-back window in days for both git history and usage log."),
  dry_run: z
    .boolean()
    .default(false)
    .describe("When true, report matches without writing any memory files."),
  scope: z
    .enum(["personal", "team"])
    .default("team")
    .describe("Scope for proposed memories."),
};

export type PatternDetectInput = {
  [K in keyof typeof PatternDetectInputSchema]: z.infer<(typeof PatternDetectInputSchema)[K]>;
};

export type PatternKind = "config_change" | "repeated_path" | "hot_file";

export interface PatternMatch {
  kind: PatternKind;
  signal: string;
  proposed_type: "convention" | "gotcha";
  proposed_slug: string;
  proposed_body: string;
  anchor_paths: string[];
}

export interface PatternDetectOutput {
  scanned_events: number;
  matches: PatternMatch[];
  /** Number of proposed memories saved (0 if dry_run). */
  saved: number;
  /** IDs of saved memories. */
  saved_ids: string[];
  notice?: string;
}

// ── Implementation ─────────────────────────────────────────────────────────

export async function patternDetect(
  input: PatternDetectInput,
  ctx: HaiveContext,
): Promise<PatternDetectOutput> {
  if (!existsSync(ctx.paths.haiveDir)) {
    return {
      scanned_events: 0, matches: [], saved: 0, saved_ids: [],
      notice: "No .ai/ directory found. Run 'hivelore init' first.",
    };
  }

  const matches: PatternMatch[] = [];

  // ── Signal 1: CONFIG_CHANGE ─────────────────────────────────────────────
  try {
    const changedFiles = gitChangedFiles(ctx.paths.root, input.since_days);
    const configFiles = changedFiles.filter((f) =>
      CONFIG_PATTERNS.some((p) => path.basename(f.toLowerCase()).includes(p)),
    );
    for (const file of configFiles.slice(0, 5)) {
      const diff = gitFileDiff(ctx.paths.root, file, input.since_days);
      if (!diff) continue;
      // Include the nearest parent dir so `cli/vitest.config.ts` and
      // `core/vitest.config.ts` produce distinct slugs instead of colliding.
      const parentDir = path.basename(path.dirname(file));
      const baseName = path.basename(file).replace(/\.[^.]+$/, "");
      const slug = `${parentDir}-${baseName}`
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase()
        .slice(0, 40);
      matches.push({
        kind: "config_change",
        signal: `Config file modified: ${file}`,
        proposed_type: "convention",
        proposed_slug: `config-change-${slug}`,
        proposed_body: [
          `# Config change: \`${file}\``,
          "",
          "This configuration file was recently modified. The diff below captures the intent.",
          "Review and update this memory with the **reason** for the change if known.",
          "",
          "```diff",
          diff.slice(0, MAX_DIFF_BYTES),
          "```",
        ].join("\n"),
        anchor_paths: [file],
      });
    }
  } catch { /* git not available or no history — skip */ }

  // ── Signals 2 & 3: usage log analysis ──────────────────────────────────
  const events = await readUsageEvents(ctx.paths);
  const cutoff = Date.now() - input.since_days * 24 * 60 * 60 * 1000;
  const recent = events.filter((e) => Date.parse(e.at) >= cutoff);

  // Build per-path occurrence counts from writing tools
  const pathCounts = new Map<string, { count: number; tools: Set<string> }>();
  for (const e of recent) {
    if (!["mem_tried", "mem_observe", "mem_save"].includes(e.tool)) continue;
    if (!e.summary) continue;
    // Extract file-like tokens from the summary
    const tokens = e.summary.match(/[^\s"'`,;()[\]{}]+\.[a-zA-Z]{1,6}/g) ?? [];
    for (const t of tokens) {
      const key = t.toLowerCase();
      const existing = pathCounts.get(key);
      if (existing) {
        existing.count++;
        existing.tools.add(e.tool);
      } else {
        pathCounts.set(key, { count: 1, tools: new Set([e.tool]) });
      }
    }
  }

  // Signal 2: REPEATED_PATH — path appears mostly in mem_tried / mem_observe
  for (const [p, { count, tools }] of pathCounts) {
    if (count < HOT_FILE_MIN) continue;
    const isGotchaSignal = tools.has("mem_tried") || tools.has("mem_observe");
    if (!isGotchaSignal) continue;
    const slug = p.replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);
    matches.push({
      kind: "repeated_path",
      signal: `Path '${p}' appears ${count}× in mem_tried/mem_observe events`,
      proposed_type: "gotcha",
      proposed_slug: `repeated-issue-${slug}`,
      proposed_body: [
        `# Recurring issue near \`${p}\``,
        "",
        `This file appeared ${count} times in failed-approach or observation events ` +
        `over the last ${input.since_days} days. ` +
        "Review the related attempt/gotcha memories and consolidate them into a single authoritative gotcha.",
        "",
        `**Source signals:** ${[...tools].join(", ")} (${count} events)`,
      ].join("\n"),
      anchor_paths: [p],
    });
  }

  // Signal 3: HOT_FILE — any path appearing ≥ HOT_FILE_MIN times in any writing tool
  for (const [p, { count, tools }] of pathCounts) {
    if (count < HOT_FILE_MIN) continue;
    if (tools.has("mem_tried") || tools.has("mem_observe")) continue; // already covered by Signal 2
    // Only flag non-config source files
    if (CONFIG_PATTERNS.some((cp) => path.basename(p).includes(cp))) continue;
    const slug = p.replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").slice(0, 40);
    matches.push({
      kind: "hot_file",
      signal: `Path '${p}' referenced ${count}× across mem_save events`,
      proposed_type: "convention",
      proposed_slug: `hot-file-${slug}`,
      proposed_body: [
        `# Frequent edits to \`${p}\``,
        "",
        `This file was referenced ${count} times in memory-saving events over the last ` +
        `${input.since_days} days — a signal that a recurring pattern or convention applies here.`,
        "",
        "**Suggested action:** review recent memories anchored to this path and extract the " +
        "common pattern as a named convention.",
      ].join("\n"),
      anchor_paths: [p],
    });
  }

  if (matches.length === 0) {
    return {
      scanned_events: recent.length,
      matches: [],
      saved: 0,
      saved_ids: [],
      notice: `No patterns detected in the last ${input.since_days} days (${recent.length} events scanned).`,
    };
  }

  if (input.dry_run) {
    return { scanned_events: recent.length, matches, saved: 0, saved_ids: [] };
  }

  // ── Save proposed memories ──────────────────────────────────────────────
  const savedIds: string[] = [];
  for (const match of matches) {
    try {
      const fm = buildFrontmatter({
        type: match.proposed_type,
        slug: match.proposed_slug,
        scope: input.scope,
        tags: ["pattern-detect", match.kind],
        paths: match.anchor_paths,
        status: "proposed",
      });
      const file = memoryFilePath(
        ctx.paths,
        fm.scope === "shared" ? "team" : fm.scope,
        fm.id,
        undefined,
      );
      if (existsSync(file)) continue; // don't overwrite existing
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(
        file,
        serializeMemory({ frontmatter: fm, body: match.proposed_body }),
        "utf8",
      );
      savedIds.push(fm.id);
    } catch { /* skip failures — non-blocking */ }
  }

  return {
    scanned_events: recent.length,
    matches,
    saved: savedIds.length,
    saved_ids: savedIds,
  };
}

// ── Git helpers ────────────────────────────────────────────────────────────

function gitChangedFiles(root: string, sinceDays: number): string[] {
  try {
    const out = execSync(
      `git log --name-only --pretty="" --diff-filter=AM --since="${sinceDays} days ago"`,
      { cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return [...new Set(out.split("\n").map((l) => l.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

function gitFileDiff(root: string, file: string, sinceDays: number): string | null {
  try {
    const out = execSync(
      `git log -p --follow --since="${sinceDays} days ago" -- "${file}"`,
      { cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] },
    );
    if (!out.trim()) return null;
    // Extract only the diff hunks (lines starting with +/- or @@)
    const diffLines = out.split("\n").filter((l) =>
      l.startsWith("+") || l.startsWith("-") || l.startsWith("@@") || l.startsWith("diff"),
    );
    return diffLines.join("\n").slice(0, MAX_DIFF_BYTES) || null;
  } catch {
    return null;
  }
}
