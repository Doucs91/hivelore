/**
 * `haive coverage` — harness coverage-gap report.
 *
 * Crosses the repo's hottest files (git churn) with the memory corpus to surface the
 * frequently-edited files that carry NO covering decision/convention/gotcha/architecture memory.
 * Those blind spots are where a confident agent is most likely to break an unwritten rule. The
 * inverse of `haive eval` (which checks the memories that exist surface correctly).
 */
import { Command } from "commander";
import { findCoverageGaps, findProjectRoot, resolveHaivePaths, type HotFile } from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { buildRadar } from "../utils/briefing-radar.js";
import { ui } from "../utils/ui.js";

interface CoverageOptions {
  json?: boolean;
  minChanges?: string;
  limit?: string;
  days?: string;
  dir?: string;
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
    .option("--min-changes <n>", "minimum git-churn count to flag a file", "3")
    .option("--limit <n>", "max gaps to report", "20")
    .option("--days <n>", "git-history lookback window in days", "90")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: CoverageOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const minChanges = Math.max(1, parseInt(opts.minChanges ?? "3", 10) || 3);
      const limit = Math.max(1, parseInt(opts.limit ?? "20", 10) || 20);
      const days = Math.max(1, parseInt(opts.days ?? "90", 10) || 90);

      const radar = await buildRadar({
        root,
        taskTokens: null,
        filePaths: [],
        daysBack: Math.ceil(days / 6), // getHotFiles multiplies daysBack by 6
        maxHotFiles: 500,
      });
      const hotFiles: HotFile[] = radar.hotFiles
        .filter((h) => !isNoisePath(h.path))
        .map((h) => ({ path: h.path, changes: h.changes }));
      const memories = await loadMemoriesFromDir(paths.memoriesDir);
      const gaps = findCoverageGaps(hotFiles, memories, { minChanges, limit });

      if (opts.json) {
        console.log(JSON.stringify({ root, scanned_hot_files: hotFiles.length, gaps }, null, 2));
        return;
      }

      if (!radar.insideGitRepo) {
        ui.warn("Not a git repository — coverage uses git churn to find hot files.");
        return;
      }
      if (gaps.length === 0) {
        ui.success(`No coverage gaps: every file changed ≥${minChanges}× is covered by a team memory.`);
        return;
      }
      console.log(ui.bold(`hAIve coverage — ${gaps.length} blind spot(s) (hot files with no covering memory)`));
      for (const gap of gaps) {
        console.log(`  ${ui.yellow("○")} ${gap.path} ${ui.dim(`(${gap.changes} change${gap.changes === 1 ? "" : "s"})`)}`);
      }
      console.log(
        ui.dim(
          "\nAdd a decision/convention/gotcha anchored to the top files, or a sensor, to close the gap.",
        ),
      );
    });
}
