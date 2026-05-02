import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  getUsage,
  loadMemoriesFromDir,
  loadUsageIndex,
  resolveHaivePaths,
  serializeMemory,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface ArchiveOptions {
  since?: string;
  type?: string;
  apply?: boolean;
  json?: boolean;
  dir?: string;
}

interface Candidate {
  id: string;
  type: string;
  status: string;
  last_seen: string;
  reason: string;
  filePath: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function registerMemoryArchive(memory: Command): void {
  memory
    .command("archive")
    .description(
      "Archive obsolete memories: marks status='deprecated' for memories not read in N days\n" +
      "  whose anchored paths have all disappeared (or have no anchor at all).\n\n" +
      "  Defaults to a DRY RUN — pass --apply to actually rewrite files.\n" +
      "  Targets `attempt` memories by default since they age the fastest.\n\n" +
      "  Recover later with `haive memory edit <id>` to set status back to validated.",
    )
    .option("--since <window>", "minimum age since last read (e.g. '180d', '6m')", "180d")
    .option("--type <type>", "limit to a memory type (default 'attempt'). Pass 'all' to scan all types.", "attempt")
    .option("--apply", "actually rewrite files (default: dry run)", false)
    .option("--json", "emit JSON instead of human-readable output", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: ArchiveOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const minDays = parseDays(opts.since ?? "180d");
      if (minDays === null) {
        ui.error(`Invalid --since value: ${opts.since}. Use formats like '180d', '6m', '1y'.`);
        process.exitCode = 1;
        return;
      }
      const cutoff = Date.now() - minDays * MS_PER_DAY;

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const usage = await loadUsageIndex(paths);
      const typeFilter = opts.type === "all" ? null : (opts.type ?? "attempt");

      const candidates: Candidate[] = [];
      for (const { memory: mem, filePath } of all) {
        const fm = mem.frontmatter;
        if (typeFilter && fm.type !== typeFilter) continue;
        // Skip already-archived states.
        if (fm.status === "deprecated" || fm.status === "rejected") continue;
        // Anchorless OR all anchored paths gone OR all anchored symbols missing
        const hasAnyAnchor = fm.anchor.paths.length + fm.anchor.symbols.length > 0;
        const allPathsGone = fm.anchor.paths.length > 0
          && fm.anchor.paths.every((p) => !existsSync(path.join(paths.root, p)));
        const isAnchorless = !hasAnyAnchor;
        if (!isAnchorless && !allPathsGone) continue;
        // Age check
        const u = getUsage(usage, fm.id);
        const lastSeen = u.last_read_at ?? fm.created_at;
        if (Date.parse(lastSeen) >= cutoff) continue;

        candidates.push({
          id: fm.id,
          type: fm.type,
          status: fm.status,
          last_seen: lastSeen,
          reason: isAnchorless
            ? `anchorless and not read since ${lastSeen.slice(0, 10)}`
            : `all ${fm.anchor.paths.length} anchored path(s) missing and not read since ${lastSeen.slice(0, 10)}`,
          filePath,
        });
      }

      if (opts.json) {
        console.log(JSON.stringify({
          dry_run: !opts.apply,
          window_days: minDays,
          candidates: candidates.length,
          archived: opts.apply ? candidates.length : 0,
          items: candidates,
        }, null, 2));
      } else {
        const header = opts.apply ? "Archiving" : "Would archive";
        console.log(ui.bold(`${header} ${candidates.length} memor${candidates.length === 1 ? "y" : "ies"} (older than ${minDays}d, type=${typeFilter ?? "all"})`));
        if (candidates.length === 0) {
          ui.info("Nothing to archive — all memories are anchored or read recently.");
          return;
        }
        for (const c of candidates) {
          console.log(`  ${ui.dim(c.last_seen.slice(0, 10))} ${c.id} ${ui.dim(`(${c.type})`)} — ${c.reason}`);
        }
      }

      if (!opts.apply) {
        if (!opts.json) {
          console.log();
          ui.info("Dry run — pass --apply to mark these as deprecated on disk.");
        }
        return;
      }

      // Apply: rewrite each file with status=deprecated.
      let archived = 0;
      let failed = 0;
      for (const c of candidates) {
        const found = all.find(({ filePath }) => filePath === c.filePath);
        if (!found) continue;
        const fm = { ...found.memory.frontmatter, status: "deprecated" as const };
        try {
          await writeFile(c.filePath, serializeMemory({ frontmatter: fm, body: found.memory.body }), "utf8");
          archived++;
        } catch (err) {
          if (!opts.json) {
            ui.error(`Failed to archive ${c.id}: ${err instanceof Error ? err.message : String(err)}`);
          }
          failed++;
        }
      }
      if (!opts.json) {
        ui.success(`Archived ${archived} memor${archived === 1 ? "y" : "ies"}${failed > 0 ? ` (${failed} failed)` : ""}`);
      }
    });
}

function parseDays(input: string): number | null {
  const m = input.match(/^(\d+)([dmy])$/);
  if (!m) return null;
  const n = parseInt(m[1] ?? "0", 10);
  const unit = m[2] ?? "d";
  if (unit === "d") return n;
  if (unit === "m") return n * 30;
  if (unit === "y") return n * 365;
  return null;
}
