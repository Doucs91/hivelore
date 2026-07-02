import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import {
  deriveConfidence,
  getUsage,
  loadCodeMap,
  loadMemoriesFromDir,
  loadUsageIndex,
  memoryMatchesAnchorPaths,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const WhyThisFileInputSchema = {
  path: z
    .string()
    .min(1)
    .describe(
      "Project-relative path to the file you want context on (e.g. 'packages/mcp/src/tools/mem-save.ts').",
    ),
  git_log_limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(5)
    .describe("How many recent commits touching this file to include."),
  memory_limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .default(5)
    .describe("Cap on memories anchored to this path."),
};

export type WhyThisFileInput = {
  [K in keyof typeof WhyThisFileInputSchema]: z.infer<(typeof WhyThisFileInputSchema)[K]>;
};

export interface WhyThisFileOutput {
  file: string;
  exists: boolean;
  recent_commits: Array<{ sha: string; author: string; relative_date: string; subject: string }>;
  memories: Array<{
    id: string;
    type: string;
    scope: string;
    confidence: string;
    body_preview: string;
  }>;
  code_map_entry: {
    summary?: string;
    loc: number;
    exports: Array<{ name: string; kind: string; line: number; description?: string }>;
  } | null;
  hints?: string[];
}

/**
 * One-shot file-context lookup: combines recent git history, memories anchored
 * to the path, and the code-map entry. Designed to answer "why is this file
 * the way it is?" in a single call instead of 3-4 manual ones.
 */
export async function whyThisFile(
  input: WhyThisFileInput,
  ctx: HaiveContext,
): Promise<WhyThisFileOutput> {
  const fileExists = existsSync(path.join(ctx.paths.root, input.path));

  const [commits, memories, codeMap] = await Promise.all([
    runGitLog(ctx.paths.root, input.path, input.git_log_limit).catch(() => []),
    collectAnchoredMemories(ctx, input.path, input.memory_limit),
    loadCodeMap(ctx.paths),
  ]);

  const codeMapEntry = codeMap?.files[input.path];

  const hints: string[] = [];
  if (!fileExists) {
    hints.push(`File '${input.path}' does not exist on disk — path may be wrong or file removed.`);
  }
  if (commits.length === 0 && fileExists) {
    hints.push("No git history found — file may be untracked or git not initialized.");
  }
  if (memories.length === 0 && fileExists) {
    hints.push(
      "No memories anchored here. If you discover something non-obvious while editing, " +
      "use mem_observe (with where=" + input.path + ") to capture it.",
    );
  }
  if (memories.some((m) => m.type === "attempt" || m.type === "gotcha")) {
    hints.push("⚠️ attempt/gotcha memories anchored to this file — read them BEFORE editing.");
  }

  return {
    file: input.path,
    exists: fileExists,
    recent_commits: commits,
    memories,
    code_map_entry: codeMapEntry
      ? {
          ...(codeMapEntry.summary ? { summary: codeMapEntry.summary } : {}),
          loc: codeMapEntry.loc,
          exports: codeMapEntry.exports.map((e) => ({
            name: e.name,
            kind: e.kind,
            line: e.line,
            ...(e.description ? { description: e.description } : {}),
          })),
        }
      : null,
    ...(hints.length > 0 ? { hints } : {}),
  };
}

async function collectAnchoredMemories(
  ctx: HaiveContext,
  filePath: string,
  limit: number,
): Promise<WhyThisFileOutput["memories"]> {
  if (!existsSync(ctx.paths.memoriesDir)) return [];
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const usage = await loadUsageIndex(ctx.paths);
  const out: WhyThisFileOutput["memories"] = [];
  for (const { memory } of all) {
    const fm = memory.frontmatter;
    if (fm.status === "rejected" || fm.status === "deprecated") continue;
    if (fm.type === "session_recap") continue;
    if (!memoryMatchesAnchorPaths(memory, [filePath])) continue;
    const u = getUsage(usage, fm.id);
    out.push({
      id: fm.id,
      type: fm.type,
      scope: fm.scope,
      confidence: deriveConfidence(fm, u),
      body_preview: memory.body.split("\n").slice(0, 6).join("\n"),
    });
    if (out.length >= limit) break;
  }
  return out;
}

async function runGitLog(
  cwd: string,
  filePath: string,
  limit: number,
): Promise<WhyThisFileOutput["recent_commits"]> {
  const sep = "<<HV>>";
  const fmt = `%h${sep}%an${sep}%ar${sep}%s`;
  const output = await runCommand(
    "git",
    ["log", `-n`, String(limit), `--pretty=format:${fmt}`, "--", filePath],
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
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
  });
}
