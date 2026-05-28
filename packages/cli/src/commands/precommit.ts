import { spawn } from "node:child_process";
import { Command } from "commander";
import {
  findProjectRoot,
  resolveHaivePaths,
} from "@hiveai/core";
import { preCommitCheck } from "@hiveai/mcp";
import { ui } from "../utils/ui.js";

interface PrecommitOptions {
  blockOn?: "any" | "high-confidence" | "never";
  noSemantic?: boolean;
  json?: boolean;
  dir?: string;
  paths?: string[];
}

export function registerPrecommit(program: Command): void {
  program
    .command("precommit")
    .description(
      "Run a pre-commit safety check: scans `git diff --cached` against known anti-patterns,\n" +
      "  surfaces conventions/decisions anchored to touched files, and warns about stale anchored memories.\n\n" +
      "  Wire it into git as: `.git/hooks/pre-commit` running `haive precommit` (exit 1 = block).\n\n" +
      "  Examples:\n" +
      "    haive precommit                                # auto-detects staged diff\n" +
      "    haive precommit --block-on any                 # block on any warning, not just high-confidence\n" +
      "    haive precommit --paths src/auth.ts src/db.ts  # explicit paths instead of git diff",
    )
    .option(
      "--block-on <mode>",
      "'any' | 'high-confidence' (default) | 'never' (report only)",
      "high-confidence",
    )
    .option("--no-semantic", "disable semantic search in anti-patterns matching")
    .option("--json", "emit JSON instead of human-readable output", false)
    .option("--paths <paths...>", "explicit paths to check (skips git diff)")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: PrecommitOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const ctx = { paths };

      let diff = "";
      let touchedPaths: string[] = opts.paths ?? [];

      if (touchedPaths.length === 0) {
        // Auto-detect from git
        try {
          diff = await runCommand("git", ["diff", "--cached"], root);
          if (!diff.trim()) {
            ui.warn("No staged changes — nothing to check. Stage with `git add` first.");
            return;
          }
          const nameOnly = await runCommand("git", ["diff", "--cached", "--name-only"], root);
          touchedPaths = nameOnly.split("\n").map((s) => s.trim()).filter(Boolean);
        } catch (err) {
          ui.error(`git diff failed: ${err instanceof Error ? err.message : String(err)}`);
          process.exit(1);
        }
      }

      const result = await preCommitCheck({
        diff: diff || undefined,
        paths: touchedPaths,
        block_on: opts.blockOn ?? "high-confidence",
        semantic: opts.noSemantic ? false : true,
      }, ctx);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        process.exit(result.should_block ? 1 : 0);
      }

      console.log(ui.bold(`hAIve precommit — ${touchedPaths.length} file(s)`));
      console.log(
        ui.dim(
          `  anti-patterns: ${result.summary.anti_patterns}  ` +
          `blocking: ${result.summary.blocking_warnings ?? result.summary.anti_patterns}  ` +
          `review: ${result.summary.review_warnings ?? 0}  ` +
          `info: ${result.summary.info_warnings ?? 0}  ` +
          `relevant memories: ${result.summary.relevant_memories}  ` +
          `stale anchors: ${result.summary.stale_anchors}`,
        ),
      );
      console.log();

      const blocking = result.warnings.filter((w) => w.level === "blocking");
      const review = result.warnings.filter((w) => w.level === "review");
      const info = result.warnings.filter((w) => w.level === "info");

      printWarnings("Blocking anti-patterns", blocking, "error");
      printWarnings("Review anti-patterns", review.slice(0, 8), "warn");
      if (info.length > 0) {
        console.log(
          ui.dim(
            `${info.length} weak anti-pattern signal${info.length === 1 ? "" : "s"} hidden. ` +
            "Use --json to inspect FYI matches.",
          ),
        );
        console.log();
      }

      if (result.relevant_memories.length > 0) {
        console.log(ui.bold("📌 Relevant conventions/decisions:"));
        for (const m of result.relevant_memories) {
          console.log(`  • ${m.id} ${ui.dim(`(${m.type}, ${m.confidence})`)}`);
        }
        console.log();
      }

      if (result.stale_anchors.length > 0) {
        console.log(ui.bold("🕒 Stale anchored memories:"));
        for (const s of result.stale_anchors) {
          console.log(`  • ${s.id}`);
          if (s.body_preview) console.log(`     ${ui.dim(s.body_preview)}`);
        }
        console.log();
      }

      if (result.should_block) {
        ui.error(`Blocking commit (block_on=${opts.blockOn ?? "high-confidence"}). Address the warnings above or pass --block-on never to bypass.`);
        process.exit(1);
      }

      if (result.warnings.length === 0 && result.stale_anchors.length === 0) {
        ui.success("No anti-patterns or stale anchors found.");
      } else {
        ui.success("Check passed (block_on threshold not met).");
      }
    });
}

function printWarnings(
  title: string,
  warnings: Array<{
    id: string;
    type: string;
    confidence: string;
    body_preview: string;
    reasons: string[];
    rationale?: string;
  }>,
  tone: "error" | "warn",
): void {
  if (warnings.length === 0) return;
  console.log(ui.bold(tone === "error" ? `✗ ${title}:` : `⚠ ${title}:`));
  for (const w of warnings) {
    const marker = tone === "error" ? ui.red("✗") : ui.yellow("⚠");
    console.log(`  ${marker} ${w.id} ${ui.dim(`(${w.type}, ${w.confidence})`)}`);
    for (const line of w.body_preview.split("\n").slice(0, 3)) {
      console.log(`     ${ui.dim(line)}`);
    }
    console.log(`     ${ui.dim("reasons:")} ${w.reasons.join(", ")}`);
    if (w.rationale) console.log(`     ${ui.dim("why shown:")} ${w.rationale}`);
  }
  console.log();
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
  });
}
