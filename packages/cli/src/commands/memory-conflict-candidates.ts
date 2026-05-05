import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findLexicalConflictPairs,
  findTopicStatusConflictPairs,
  findProjectRoot,
  resolveHaivePaths,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

type MemType = "decision" | "architecture" | "convention" | "gotcha";

interface CandOpts {
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
    .command("conflict-candidates")
    .description(
      "Heuristic conflict candidates (lexical Jaccard + same-topic validated/rejected pairs) — aligns with MCP mem_conflict_candidates.",
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
    .action(async (opts: CandOpts) => {
      const root = path.resolve(opts.dir ?? process.cwd());
      const paths = resolveHaivePaths(findProjectRoot(root));
      if (!existsSync(paths.memoriesDir)) {
        ui.error("No memories — run `haive init`.");
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
    });
}
