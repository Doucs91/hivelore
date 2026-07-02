/**
 * `hivelore memory seed-git` — cold-start the corpus from git history.
 *
 * A fresh repo has no memories, so the harness has no feedforward value until the team invests.
 * Reverts and urgent fixups are the cheapest signal of a real, repo-specific mistake already paid
 * for. This scans `git log`, proposes DRAFT `attempt` seeds (never validated — human reviews), and
 * (with --apply) writes them so future briefings carry the lesson. Closes Fowler's "legacy is hard"
 * harnessability gap with zero manual authoring.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import {
  buildFrontmatter,
  findProjectRoot,
  memoryFilePath,
  proposeSeedsFromCommits,
  resolveHaivePaths,
  serializeMemory,
  type GitCommit,
  type MemoryScope,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

const exec = promisify(execFile);

export interface SeedGitOptions {
  apply?: boolean;
  limit?: string;
  days?: string;
  scope?: MemoryScope;
  json?: boolean;
  dir?: string;
}

export function registerMemorySeedGit(memory: Command): void {
  memory
    .command("seed-git", { hidden: true })
    .description("Propose draft `attempt` seeds from revert/hotfix commits in git history (cold-start)")
    .option("--apply", "write the proposed seeds as draft memories (default: preview only)", false)
    .option("--limit <n>", "max seeds to propose", "20")
    .option("--days <n>", "git-history lookback window in days", "365")
    .option("--scope <scope>", "personal | team", "team")
    .option("--json", "emit JSON", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SeedGitOptions) => runGitSeed(opts));
}

export async function runGitSeed(opts: SeedGitOptions): Promise<void> {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) {
        ui.error(`No .ai/ found at ${root}. Run \`hivelore init\` first.`);
        process.exitCode = 1;
        return;
      }

      const limit = Math.max(1, parseInt(opts.limit ?? "20", 10) || 20);
      const days = Math.max(1, parseInt(opts.days ?? "365", 10) || 365);
      const commits = await readCommits(root, days);
      const proposals = proposeSeedsFromCommits(commits, limit);

      if (opts.json) {
        console.log(JSON.stringify({ scanned_commits: commits.length, proposals, applied: Boolean(opts.apply) }, null, 2));
      } else if (proposals.length === 0) {
        ui.info("No revert/hotfix signals found in git history — nothing to seed.");
        return;
      } else {
        console.log(ui.bold(`Hivelore seed-git — ${proposals.length} proposal(s) from ${commits.length} commit(s)`));
        for (const p of proposals) {
          console.log(`  ${ui.yellow("◆")} ${ui.dim(`[${p.kind}]`)} ${p.what}`);
          if (p.paths.length > 0) console.log(`     ${ui.dim("paths:")} ${p.paths.join(", ")}`);
        }
      }

      if (!opts.apply) {
        if (!opts.json) ui.info("Preview only — re-run with --apply to write these as draft memories.");
        return;
      }

      let written = 0;
      for (const p of proposals) {
        const fm = {
          ...buildFrontmatter({
            type: "attempt",
            slug: p.slug,
            scope: opts.scope ?? "team",
            tags: ["seed", "git-history", p.kind],
            paths: p.paths,
          }),
          status: "draft" as const, // human reviews before it becomes validated
        };
        const body = `# ${p.what}\n\n**Why it failed / do NOT use:** ${p.why_failed}\n\n_Seeded from git ${p.kind} commit ${p.source_sha}. Review and validate (or delete) — not yet authoritative._\n`;
        const file = memoryFilePath(paths, fm.scope, fm.id, fm.module);
        if (existsSync(file)) continue;
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, serializeMemory({ frontmatter: fm, body }), "utf8");
        written += 1;
      }
      if (!opts.json) {
        ui.success(`Wrote ${written} draft seed(s). Review them: \`hivelore memory pending\` → validate or delete.`);
      }
}

/** Read recent commits with their touched files for seeding. Best-effort; returns [] off-git. */
async function readCommits(root: string, days: number): Promise<GitCommit[]> {
  try {
    const { stdout } = await exec(
      "git",
      ["log", `--since=${days}.days.ago`, "--name-only", "--pretty=format:%x1f%h%x1f%s", "-n", "500"],
      { cwd: root, maxBuffer: 8 * 1024 * 1024 },
    );
    const blocks = stdout.split("\x1f").filter((b) => b.length > 0);
    const commits: GitCommit[] = [];
    for (let i = 0; i + 1 < blocks.length; i += 2) {
      const sha = blocks[i]!.trim();
      const tail = blocks[i + 1]!;
      const lines = tail.split("\n").map((l) => l.trim()).filter(Boolean);
      const subject = lines.shift() ?? "";
      commits.push({ sha, subject, files: lines });
    }
    return commits;
  } catch {
    return [];
  }
}
