import { existsSync } from "node:fs";
import { Command } from "commander";
import {
  compareImpact,
  computeImpact,
  findProjectRoot,
  getUsage,
  loadUsageIndex,
  resolveHaivePaths,
  summarizeImpact,
  type ImpactScore,
  type ImpactTier,
} from "@hivelore/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface ImpactOptions {
  id?: string;
  prune?: boolean;
  tier?: string;
  json?: boolean;
  dir?: string;
}

interface ImpactRow {
  id: string;
  type: string;
  scope: string;
  status: string;
  impact: ImpactScore;
}

export function registerMemoryImpact(memory: Command): void {
  memory
    .command("impact")
    .description(
      "Score memories by demonstrated utility (reads + applied outcomes + sensor fires " +
        "vs rejections, staleness, dormancy) and surface prune candidates.",
    )
    .option("--id <id>", "show impact for a single memory id")
    .option("--prune", "list only prune candidates (dead weight worth reviewing)", false)
    .option("--tier <tier>", "filter to a tier: high | medium | low | dormant")
    .option("--json", "emit JSON", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: ImpactOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}. Run \`hivelore init\` first.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const usageIndex = await loadUsageIndex(paths);

      let rows: ImpactRow[] = all
        .filter((m) => !opts.id || m.memory.frontmatter.id === opts.id)
        .map(({ memory: mem }) => {
          const fm = mem.frontmatter;
          return {
            id: fm.id,
            type: fm.type,
            scope: fm.scope,
            status: fm.status,
            impact: computeImpact(fm, getUsage(usageIndex, fm.id)),
          };
        });

      if (opts.prune) rows = rows.filter((r) => r.impact.pruneCandidate);
      if (opts.tier) {
        const tier = opts.tier as ImpactTier;
        rows = rows.filter((r) => r.impact.tier === tier);
      }
      rows.sort((a, b) => compareImpact(a.impact, b.impact));

      const summary = summarizeImpact(all.map((m) => computeImpact(m.memory.frontmatter, getUsage(usageIndex, m.memory.frontmatter.id))));

      if (opts.json) {
        console.log(JSON.stringify({ root, summary, rows }, null, 2));
        return;
      }

      if (rows.length === 0) {
        ui.info(opts.prune ? "No prune candidates — every memory earns its keep." : "No memories matched.");
        return;
      }

      console.log(ui.bold(`Hivelore memory impact — ${root}`));
      console.log(
        ui.dim(
          `${summary.total} memories · ${summary.high} high · ${summary.medium} medium · ` +
            `${summary.low} low · ${summary.dormant} dormant · ${summary.prune_candidates} prune candidates`,
        ),
      );
      console.log();
      console.log(`${"score".padStart(5)}  ${"tier".padEnd(7)} ${pad("id", 52)} ${"prune".padEnd(5)} signals`);
      console.log("─".repeat(108));
      for (const r of rows) {
        const score = r.impact.score.toFixed(2).padStart(5);
        const tier = tierBadge(r.impact.tier).padEnd(7);
        const prune = r.impact.pruneCandidate ? ui.yellow("prune") : "     ";
        console.log(`${score}  ${tier} ${pad(r.id, 52)} ${prune} ${ui.dim(r.impact.signals.join(", ") || "no signals")}`);
      }

      if (!opts.prune && summary.prune_candidates > 0) {
        console.log();
        console.log(ui.dim(`Tip: \`hivelore memory impact --prune\` lists the ${summary.prune_candidates} prune candidate(s).`));
      }
    });
}

function tierBadge(tier: ImpactTier): string {
  switch (tier) {
    case "high": return ui.green(tier);
    case "medium": return ui.yellow(tier);
    case "dormant": return ui.dim(tier);
    default: return tier; // low
  }
}

function pad(value: string, width: number): string {
  if (value.length <= width) return value.padEnd(width);
  return value.slice(0, width - 1) + "…";
}
