import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import {
  findProjectRoot,
  literalMatchesAllTokens,
  loadMemoriesFromDir,
  memoryMatchesAnchorPaths,
  resolveHaivePaths,
  tokenizeQuery,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface BriefingOptions {
  task?: string;
  files?: string;
  maxMemories?: string;
  scope?: string;
  dir?: string;
}

export function registerBriefing(program: Command): void {
  program
    .command("briefing")
    .description(
      "Print project context + relevant memories in one shot — ideal for agent onboarding",
    )
    .option("--task <text>", "what you are about to do — filters memories by relevance")
    .option("--files <csv>", "comma-separated file paths being worked on (anchors memories)")
    .option("--max-memories <n>", "cap on memories surfaced", "10")
    .option(
      "--scope <scope>",
      "personal | team | module (default: team + validated only)",
      "team",
    )
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: BriefingOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);

      // Project context
      if (existsSync(paths.projectContext)) {
        const ctx = await readFile(paths.projectContext, "utf8");
        console.log(`${ui.bold("=== Project Context ===")}\n`);
        console.log(ctx.trim());
        console.log();
      } else {
        ui.warn(
          "No project-context.md found. Run `haive init` and the `bootstrap_project` MCP prompt to set it up.",
        );
      }

      if (!existsSync(paths.memoriesDir)) return;

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const filePaths = parseCsv(opts.files);
      const tokens = opts.task ? tokenizeQuery(opts.task) : null;
      const maxMemories = Math.max(1, Number(opts.maxMemories ?? 10));

      // Filter: exclude noise statuses
      const scopeFilter = opts.scope ?? "team";
      const candidates = all.filter(({ memory: mem }) => {
        const fm = mem.frontmatter;
        if (fm.status === "rejected" || fm.status === "deprecated") return false;
        if (scopeFilter !== "all" && fm.scope !== scopeFilter) return false;
        return true;
      });

      // Score by relevance
      const scored = candidates.map(({ memory: mem, filePath }) => {
        const fm = mem.frontmatter;
        let score = 0;
        if (fm.status === "validated") score += 3;
        else if (fm.status === "proposed") score += 1;
        if (filePaths.length > 0 && memoryMatchesAnchorPaths(mem, filePaths)) score += 4;
        if (tokens && literalMatchesAllTokens(mem, tokens)) score += 3;
        return { memory: mem, filePath, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, maxMemories);

      if (top.length === 0) {
        ui.info("No relevant memories found.");
        return;
      }

      console.log(`${ui.bold("=== Relevant Memories ===")}\n`);
      for (const { memory: mem } of top) {
        const fm = mem.frontmatter;
        const badge = ui.statusBadge(fm.status);
        console.log(
          `${ui.bold(fm.id)}  ${ui.dim(fm.scope + "/" + fm.type)}  ${badge}`,
        );
        console.log(mem.body.trim());
        console.log();
      }
      console.log(ui.dim(`${top.length} memor${top.length === 1 ? "y" : "ies"} surfaced`));
    });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
