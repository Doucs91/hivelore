/**
 * `hivelore coverage` — harness coverage-gap report.
 *
 * Crosses the repo's hottest files (git churn) with the memory corpus to surface the
 * frequently-edited files that carry NO covering decision/convention/gotcha/architecture memory.
 * Those blind spots are where a confident agent is most likely to break an unwritten rule. The
 * inverse of `hivelore eval` (which checks the memories that exist surface correctly).
 */
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findCoverageGaps,
  findProjectRoot,
  mergeHotFiles,
  resolveHaivePaths,
  tallyHotFiles,
  type HotFile,
} from "@hivelore/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { buildRadar } from "../utils/briefing-radar.js";
import { ui } from "../utils/ui.js";

interface CoverageOptions {
  json?: boolean;
  minChanges?: string;
  limit?: string;
  days?: string;
  source?: string;
  dir?: string;
}

/**
 * Agent-edit heat: files touched by Edit/Write/Bash, captured by the `hivelore observe` PostToolUse hook
 * into `.ai/.cache/observations.jsonl`. Complements committed git churn — surfaces files agents work
 * on heavily that may not yet show up in git history (new work, uncommitted churn).
 */
async function readAgentHotFiles(root: string, cacheFile: string, sinceMs: number): Promise<HotFile[]> {
  if (!existsSync(cacheFile)) return [];
  const raw = await readFile(cacheFile, "utf8").catch(() => "");
  const files: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obs = JSON.parse(trimmed) as { ts?: string; files?: string[] };
      if (sinceMs > 0 && obs.ts) {
        const t = Date.parse(obs.ts);
        if (Number.isFinite(t) && t < sinceMs) continue;
      }
      for (const f of obs.files ?? []) {
        if (typeof f !== "string" || !f) continue;
        const rel = path.isAbsolute(f) ? path.relative(root, f) : f;
        // Drop paths that escape the repo (relative starts with ..) — they're not our blind spots.
        if (rel.startsWith("..")) continue;
        files.push(rel);
      }
    } catch {
      // skip a corrupt observation line
    }
  }
  return tallyHotFiles(files, "agent");
}

/** Generated / non-source files that should never count as a coverage blind spot. */
function isNoisePath(p: string): boolean {
  if (/(^|\/)(node_modules|dist|build|coverage|\.next)\//.test(p)) return true;
  if (p.startsWith(".ai/")) return true;
  if (/\.(jsonl|lock|map|snap|min\.js)$/.test(p)) return true;
  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$/.test(p)) return true;
  if (/(^|\/)(CHANGELOG|LICENSE)(\.md)?$/.test(p)) return true;
  return false;
}

export function registerCoverage(program: Command): void {
  program
    .command("coverage")
    .description(
      "Coverage-gap report: frequently-edited files with no covering team memory (blind spots).",
    )
    .option("--json", "emit JSON", false)
    .option("--min-changes <n>", "minimum churn count to flag a file", "3")
    .option("--limit <n>", "max gaps to report", "20")
    .option("--days <n>", "lookback window in days (git history + agent edits)", "90")
    .option("--source <which>", "heat source: git | agent | both", "both")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: CoverageOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const minChanges = Math.max(1, parseInt(opts.minChanges ?? "3", 10) || 3);
      const limit = Math.max(1, parseInt(opts.limit ?? "20", 10) || 20);
      const days = Math.max(1, parseInt(opts.days ?? "90", 10) || 90);
      const source = (opts.source ?? "both").toLowerCase();
      if (!["git", "agent", "both"].includes(source)) {
        ui.error("--source must be one of: git | agent | both");
        process.exitCode = 1;
        return;
      }
      const useGit = source === "git" || source === "both";
      const useAgent = source === "agent" || source === "both";

      const radar = useGit
        ? await buildRadar({
            root,
            taskTokens: null,
            filePaths: [],
            daysBack: Math.ceil(days / 6), // getHotFiles multiplies daysBack by 6
            maxHotFiles: 500,
          })
        : null;
      const gitHotFiles: HotFile[] = (radar?.hotFiles ?? [])
        .filter((h) => !isNoisePath(h.path))
        .map((h) => ({ path: h.path, changes: h.changes, source: "git" as const }));

      const sinceMs = Date.now() - days * 86_400_000;
      const agentHotFiles: HotFile[] = useAgent
        ? (await readAgentHotFiles(root, path.join(paths.haiveDir, ".cache", "observations.jsonl"), sinceMs))
            .filter((h) => !isNoisePath(h.path))
        : [];

      const hotFiles = mergeHotFiles(gitHotFiles, agentHotFiles);
      const memories = await loadMemoriesFromDir(paths.memoriesDir);
      const gaps = findCoverageGaps(hotFiles, memories, { minChanges, limit });

      if (opts.json) {
        console.log(JSON.stringify({
          root,
          source,
          scanned_hot_files: hotFiles.length,
          git_hot_files: gitHotFiles.length,
          agent_hot_files: agentHotFiles.length,
          gaps,
        }, null, 2));
        return;
      }

      if (useGit && radar && !radar.insideGitRepo && agentHotFiles.length === 0) {
        ui.warn("Not a git repository and no agent-edit history — nothing to cross-check.");
        return;
      }
      if (gaps.length === 0) {
        ui.success(`No coverage gaps: every file changed ≥${minChanges}× is covered by a team memory.`);
        return;
      }
      console.log(ui.bold(`Hivelore coverage — ${gaps.length} blind spot(s) (hot files with no covering memory)`));
      for (const gap of gaps) {
        const src = gap.source ? ui.dim(` [${gap.source}]`) : "";
        console.log(`  ${ui.yellow("○")} ${gap.path} ${ui.dim(`(${gap.changes} change${gap.changes === 1 ? "" : "s"})`)}${src}`);
      }
      console.log(
        ui.dim(
          "\nAdd a decision/convention/gotcha anchored to the top files, or a sensor, to close the gap.",
        ),
      );
    });
}
