import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  deriveConfidence,
  getUsage,
  loadMemoriesFromDir,
  loadUsageIndex,
  pathsOverlap as singlePathsOverlap,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const WhyThisDecisionInputSchema = {
  id: z
    .string()
    .min(1)
    .describe("Memory id to inspect (e.g. '2026-04-25-decision-esm-only')."),
  git_log_limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(5)
    .describe("How many recent commits per anchor path to surface."),
};

export type WhyThisDecisionInput = {
  [K in keyof typeof WhyThisDecisionInputSchema]: z.infer<(typeof WhyThisDecisionInputSchema)[K]>;
};

export interface WhyThisDecisionOutput {
  found: boolean;
  decision?: {
    id: string;
    type: string;
    scope: string;
    status: string;
    confidence: string;
    body: string;
    created_at: string;
  };
  /** Memories explicitly linked via related_ids on the decision (or vice versa). */
  related: Array<{
    id: string;
    type: string;
    scope: string;
    confidence: string;
    body_preview: string;
    relation: "explicit" | "back-link";
  }>;
  /** Other memories anchored to overlapping paths — implicit context. */
  path_neighbors: Array<{
    id: string;
    type: string;
    scope: string;
    confidence: string;
    overlap: string[];
    body_preview: string;
  }>;
  /** Recent git commits touching any of the decision's anchored paths. */
  recent_commits: Array<{
    path: string;
    sha: string;
    author: string;
    relative_date: string;
    subject: string;
  }>;
  hints?: string[];
  notice?: string;
}

/**
 * Trace the genealogy of a `decision` memory: the decision itself + memories
 * explicitly linked to it + memories anchored to overlapping paths + recent
 * commits touching those paths. One call instead of 4-5 manual lookups.
 *
 * Works on any memory type, but is optimized for `decision` and `architecture`.
 */
export async function whyThisDecision(
  input: WhyThisDecisionInput,
  ctx: HaiveContext,
): Promise<WhyThisDecisionOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return {
      found: false,
      related: [],
      path_neighbors: [],
      recent_commits: [],
      notice: "No .ai/memories directory.",
    };
  }
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const usage = await loadUsageIndex(ctx.paths);
  const target = all.find(({ memory }) => memory.frontmatter.id === input.id);
  if (!target) {
    return {
      found: false,
      related: [],
      path_neighbors: [],
      recent_commits: [],
      notice: `Memory '${input.id}' not found.`,
    };
  }

  const fm = target.memory.frontmatter;
  const targetUsage = getUsage(usage, fm.id);
  const decision = {
    id: fm.id,
    type: fm.type,
    scope: fm.scope,
    status: fm.status,
    confidence: deriveConfidence(fm, targetUsage),
    body: target.memory.body,
    created_at: fm.created_at,
  };

  // ── related: explicit related_ids + reverse links ──────────────────────
  const relatedSet = new Set(fm.related_ids ?? []);
  const related: WhyThisDecisionOutput["related"] = [];
  for (const { memory } of all) {
    if (memory.frontmatter.id === fm.id) continue;
    const isExplicit = relatedSet.has(memory.frontmatter.id);
    const isBackLink = (memory.frontmatter.related_ids ?? []).includes(fm.id);
    if (!isExplicit && !isBackLink) continue;
    const u = getUsage(usage, memory.frontmatter.id);
    related.push({
      id: memory.frontmatter.id,
      type: memory.frontmatter.type,
      scope: memory.frontmatter.scope,
      confidence: deriveConfidence(memory.frontmatter, u),
      body_preview: memory.body.split("\n").slice(0, 4).join("\n").slice(0, 300),
      relation: isExplicit ? "explicit" : "back-link",
    });
  }

  // ── path_neighbors: memories anchored to overlapping paths ─────────────
  const targetPaths = fm.anchor.paths;
  const path_neighbors: WhyThisDecisionOutput["path_neighbors"] = [];
  if (targetPaths.length > 0) {
    for (const { memory } of all) {
      if (memory.frontmatter.id === fm.id) continue;
      if (relatedSet.has(memory.frontmatter.id)) continue; // already in related
      const overlappingPaths = memory.frontmatter.anchor.paths.filter((p) =>
        targetPaths.some((tp) => singlePathsOverlap(p, tp)),
      );
      if (overlappingPaths.length === 0) continue;
      const u = getUsage(usage, memory.frontmatter.id);
      path_neighbors.push({
        id: memory.frontmatter.id,
        type: memory.frontmatter.type,
        scope: memory.frontmatter.scope,
        confidence: deriveConfidence(memory.frontmatter, u),
        overlap: overlappingPaths,
        body_preview: memory.body.split("\n").slice(0, 3).join("\n").slice(0, 200),
      });
      if (path_neighbors.length >= 10) break;
    }
  }

  // ── recent_commits: git log on each anchored path ──────────────────────
  const recent_commits: WhyThisDecisionOutput["recent_commits"] = [];
  for (const p of targetPaths.slice(0, 5)) {
    try {
      const commits = await runGitLog(ctx.paths.root, p, input.git_log_limit);
      for (const c of commits) recent_commits.push({ path: p, ...c });
    } catch {
      /* git not available or path untracked — silent */
    }
  }

  const hints: string[] = [];
  if (decision.confidence === "low" || decision.confidence === "stale") {
    hints.push(`⚠️ Confidence is ${decision.confidence}. Verify this decision still applies before quoting it.`);
  }
  if (related.length === 0 && path_neighbors.length === 0 && targetPaths.length === 0) {
    hints.push("No related memories and no anchored paths — this decision is isolated; consider adding related_ids or paths.");
  }
  if (fm.type !== "decision" && fm.type !== "architecture") {
    hints.push(`Memory type is '${fm.type}', not 'decision'/'architecture' — output may be less informative.`);
  }

  return {
    found: true,
    decision,
    related,
    path_neighbors,
    recent_commits,
    ...(hints.length > 0 ? { hints } : {}),
  };
}

async function runGitLog(
  cwd: string,
  filePath: string,
  limit: number,
): Promise<Array<{ sha: string; author: string; relative_date: string; subject: string }>> {
  const sep = "<<HV>>";
  const fmt = `%h${sep}%an${sep}%ar${sep}%s`;
  const output = await runCommand(
    "git",
    ["log", "-n", String(limit), `--pretty=format:${fmt}`, "--", filePath],
    cwd,
  );
  if (!output.trim()) return [];
  return output
    .split("\n")
    .map((line) => {
      const [sha = "", author = "", relative_date = "", subject = ""] = line.split(sep);
      return { sha, author, relative_date, subject };
    })
    .filter((c) => c.sha);
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
  });
}
