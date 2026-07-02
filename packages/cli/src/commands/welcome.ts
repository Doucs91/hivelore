/**
 * Curated onboarding: print high-signal team memories in read order — no MCP required.
 * Also prints a corpus-summary block so returning devs can see the current harness state at a glance.
 */
import { existsSync } from "node:fs";
import { Command } from "commander";
import {
  findProjectRoot,
  loadMemoriesFromDir,
  resolveHaivePaths,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

const TYPE_RANK: Record<string, number> = {
  skill: 0,
  decision: 1,
  architecture: 2,
  convention: 3,
  glossary: 4,
  gotcha: 5,
  attempt: 6,
};

interface WelcomeOpts {
  limit?: string;
  dir?: string;
}

export function registerWelcome(program: Command): void {
  program
    .command("welcome")
    .description(
      "Onboarding checklist: ranks validated/proposed **team** memories by type.\n" +
      "Use after `hivelore init` so new devs skim institutional knowledge quickly.\n\n" +
      "  hivelore welcome\n" +
      "  hivelore welcome --limit 15\n",
    )
    .option("--limit <n>", "maximum memories listed", "20")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: WelcomeOpts) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No memories at ${paths.memoriesDir}. Run 'hivelore init' first.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const team = all.filter(
        ({ memory }) =>
          memory.frontmatter.scope === "team" &&
          memory.frontmatter.status !== "rejected" &&
          memory.frontmatter.status !== "deprecated" &&
          memory.frontmatter.status !== "stale" &&
          memory.frontmatter.type !== "session_recap",
      );

      team.sort((a, b) => {
        const ta = TYPE_RANK[a.memory.frontmatter.type] ?? 99;
        const tb = TYPE_RANK[b.memory.frontmatter.type] ?? 99;
        if (ta !== tb) return ta - tb;
        const sta = a.memory.frontmatter.status === "validated" ? 0 : 1;
        const stb = b.memory.frontmatter.status === "validated" ? 0 : 1;
        if (sta !== stb) return sta - stb;
        return b.memory.frontmatter.created_at.localeCompare(a.memory.frontmatter.created_at);
      });

      const cap = Math.max(1, Math.min(500, Number(opts.limit) || 20));
      const pick = team.slice(0, cap);

      // ── Corpus summary ───────────────────────────────────────────────────
      const totalAll = all.length;
      const validated = all.filter(({ memory }) => memory.frontmatter.status === "validated").length;
      const withSensor = all.filter(({ memory }) => memory.frontmatter.sensor != null).length;
      const drafts = all.filter(({ memory }) => memory.frontmatter.status === "draft").length;
      const proposed = all.filter(({ memory }) => memory.frontmatter.status === "proposed").length;

      const summaryLines: string[] = [
        `  Corpus  : ${totalAll} memories (${validated} validated, ${drafts + proposed} pending review)`,
        `  Sensors : ${withSensor} active`,
      ];
      const summaryWidth = Math.max(...summaryLines.map((l) => l.length), 44);
      const bar = "─".repeat(summaryWidth + 2);
      console.log(ui.bold(`┌${bar}┐`));
      console.log(ui.bold(`│`) + `  Hivelore corpus`.padEnd(summaryWidth + 1) + ui.bold(`│`));
      console.log(ui.bold(`├${bar}┤`));
      for (const line of summaryLines) {
        console.log(ui.bold(`│`) + line.padEnd(summaryWidth + 2) + ui.bold(`│`));
      }
      console.log(ui.bold(`└${bar}┘`));
      console.log();
      // ────────────────────────────────────────────────────────────────────

      console.log(ui.bold(`Hivelore welcome — ${pick.length} team memories (${root})`));
      console.log(ui.dim(`Next: invoke get_briefing with your task or run 'hivelore briefing --task "…"'`));

      if (pick.length === 0) {
        ui.warn("No team memories yet — add some with 'hivelore memory save' or promote personal ones.");
        return;
      }

      let i = 1;
      for (const { memory } of pick) {
        const fm = memory.frontmatter;
        const head = memory.body.match(/^#\s+(.+)/m)?.[1]?.trim();
        const line = head ?? fm.id;
        console.log(
          `${String(i).padStart(2, " ")}  ${fm.type.padEnd(12)} ${fm.status.padEnd(10)} ${ui.dim(fm.id)}\n    ${line}`,
        );
        i++;
      }
    });
}
