import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findLexicalConflictPairs,
  findTopicStatusConflictPairs,
  findProjectRoot,
  resolveHaivePaths,
} from "@hivelore/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

type MemType = "decision" | "architecture" | "convention" | "gotcha";

export interface CandOpts {
  sinceDays: string;
  types: string;
  minJaccard: string;
  maxPairs: string;
  maxScan: string;
  maxTopicPairs: string;
  dir?: string;
}

function parseTypes(csv: string): MemType[] {
  const allowed: MemType[] = ["decision", "architecture", "convention", "gotcha"];
  const parts = csv.split(",").map((s) => s.trim().toLowerCase());
  const out = parts.filter((p): p is MemType => allowed.includes(p as MemType));
  return out.length ? out : ["decision", "architecture"];
}

export function registerMemoryConflictCandidates(memory: Command): void {
  memory
    .command("conflicts [id_a] [id_b]")
    .alias("conflict-candidates")
    .description(
      "Find likely-conflicting memory pairs; pass two ids to resolve one pair guided.\n\n" +
      "  hivelore memory conflicts                 # list heuristic candidates\n" +
      "  hivelore memory conflicts <id_a> <id_b>   # guided supersede/merge of one pair\n",
    )
    .option("-d, --dir <dir>", "project root", process.cwd())
    .option("--since-days <n>", "only memories created within N days (lexical scan)", "365")
    .option(
      "--types <csv>",
      "decision,architecture,convention,gotcha (lexical scan)",
      "decision,architecture",
    )
    .option("--min-jaccard <x>", "minimum Jaccard for lexical pairs", "0.45")
    .option("--max-pairs <n>", "cap lexical pairs", "20")
    .option("--max-scan <n>", "max memories scanned (lexical)", "500")
    .option("--max-topic-pairs <n>", "cap topic/status pairs", "20")
    .option("--yes", "resolution mode: apply the recommended action without prompting", false)
    .action(async (idA: string | undefined, idB: string | undefined, opts: CandOpts & { yes?: boolean }) => {
      if (idA && idB) {
        // Absorbed `memory resolve-conflict` (v0.32.0): two ids switch to guided resolution.
        const { runResolveConflict } = await import("./memory-resolve-conflict.js");
        await runResolveConflict(idA, idB, { dir: opts.dir, yes: opts.yes });
        return;
      }
      if (idA && !idB) {
        console.error("Pass BOTH ids to resolve a pair, or none to list candidates.");
        process.exitCode = 1;
        return;
      }
      await runConflictCandidates(opts);
    });
}

export async function runConflictCandidates(opts: CandOpts): Promise<void> {
      const root = path.resolve(opts.dir ?? process.cwd());
      const paths = resolveHaivePaths(findProjectRoot(root));
      if (!existsSync(paths.memoriesDir)) {
        ui.error("No memories — run `hivelore init`.");
        process.exitCode = 1;
        return;
      }

      const sinceDays = Math.max(1, parseInt(opts.sinceDays, 10) || 365);
      const minJaccard = parseFloat(opts.minJaccard) || 0.45;
      const maxPairs = Math.min(100, Math.max(1, parseInt(opts.maxPairs, 10) || 20));
      const maxScan = Math.min(2000, Math.max(1, parseInt(opts.maxScan, 10) || 500));
      const maxTopicPairs = Math.min(100, Math.max(1, parseInt(opts.maxTopicPairs, 10) || 20));

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const lexical = findLexicalConflictPairs(all, {
        sinceDays,
        types: parseTypes(opts.types),
        minJaccard,
        maxPairs,
        maxScan,
      });
      const topicStatusPairs = findTopicStatusConflictPairs(all, maxTopicPairs);

      console.log(
        JSON.stringify(
          {
            pairs: lexical.pairs,
            topic_status_pairs: topicStatusPairs,
            scanned: lexical.scanned,
            truncated: lexical.truncated,
          },
          null,
          2,
        ),
      );
}
