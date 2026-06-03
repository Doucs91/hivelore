import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  resolveHaivePaths,
  BRIDGE_TARGET_PATH,
  BRIDGE_TARGETS,
  type BridgeTarget,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";
import { writeBridgeFiles } from "../utils/bridge-files.js";

interface BridgesSyncOptions {
  all?: boolean;
  only?: string;
  maxMemories?: string;
  dryRun?: boolean;
  dir?: string;
}

export function registerBridges(program: Command): void {
  const bridges = program
    .command("bridges")
    .description(
      "Generate native agent bridge files from the hAIve corpus.\n" +
      "  Bridges inject top validated memories and block sensors into agent-harness-specific\n" +
      "  config files (.cursor/rules/haive-memories.mdc, .clinerules, .windsurfrules,\n" +
      "  .continuerules, .sourcegraph/cody-rules.md, .rules, AGENTS.md,\n" +
      "  .github/copilot-instructions.md).\n" +
      "  This is the reach differentiator vs memories.sh: our bridges carry enforcement, not just injection.\n\n" +
      "  Example:\n" +
      "    haive bridges sync --all\n" +
      "    haive bridges sync --only cline,windsurf\n",
    );

  bridges
    .command("sync")
    .description(
      "Regenerate bridge files idempotently (marker-based, preserves manual content outside markers).\n" +
      "  Supported targets: " + BRIDGE_TARGETS.join(", ") + "\n",
    )
    .option("--all", "generate all supported bridge targets")
    .option(
      "--only <targets>",
      "comma-separated list of targets to generate (e.g. cline,windsurf,agents)",
    )
    .option("--max-memories <n>", "max memories to inject per bridge", "8")
    .option("--dry-run", "show what would change without writing")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: BridgesSyncOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const dryRun = opts.dryRun === true;

      if (!existsSync(paths.memoriesDir)) {
        ui.warn(`No .ai/memories at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      // ── Determine targets ─────────────────────────────────────────────
      let targets: BridgeTarget[];
      if (opts.only) {
        const requested = opts.only
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        const invalid = requested.filter((t) => !BRIDGE_TARGETS.includes(t as BridgeTarget));
        if (invalid.length > 0) {
          ui.error(`Unknown bridge target(s): ${invalid.join(", ")}. Valid: ${BRIDGE_TARGETS.join(", ")}`);
          process.exitCode = 1;
          return;
        }
        targets = requested as BridgeTarget[];
      } else if (opts.all) {
        targets = BRIDGE_TARGETS;
      } else {
        // Default: generate only for files that already exist in the project.
        targets = BRIDGE_TARGETS.filter((t) =>
          existsSync(path.join(root, BRIDGE_TARGET_PATH[t])),
        );
        if (targets.length === 0) {
          ui.info(
            "No existing bridge files detected. Pass --all to generate all targets, or " +
            "--only <target> to generate a specific one.",
          );
          return;
        }
      }

      // ── Generate + write (delegated to the shared writer) ─────────────
      const maxMemories = Math.max(1, Number(opts.maxMemories ?? 8));
      const res = await writeBridgeFiles(root, paths, { targets, maxMemories, dryRun });

      if (dryRun) {
        for (const p of res.created) console.log(ui.dim(`[dry-run] would create ${p}`));
        for (const p of res.updated) console.log(ui.dim(`[dry-run] would update ${p}`));
        return;
      }
      for (const p of res.created) console.log(ui.dim(`bridges: created ${p}`));
      for (const p of res.updated) console.log(ui.dim(`bridges: updated ${p}`));

      const parts: string[] = [];
      if (res.created.length > 0) parts.push(`${res.created.length} created`);
      if (res.updated.length > 0) parts.push(`${res.updated.length} updated`);
      if (res.unchanged.length > 0) parts.push(`${res.unchanged.length} unchanged`);
      console.log(ui.dim(`bridges: ${parts.join(" · ") || "nothing to do"}`));
    });

  // ── List subcommand ───────────────────────────────────────────────────
  bridges
    .command("list")
    .description("List bridge targets and their status in this project")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: { dir?: string }) => {
      const root = findProjectRoot(opts.dir);
      console.log(ui.bold("hAIve bridge targets:"));
      for (const target of BRIDGE_TARGETS) {
        const relPath = BRIDGE_TARGET_PATH[target];
        const exists = existsSync(path.join(root, relPath));
        const marker = exists ? ui.dim("✓") : ui.dim("·");
        console.log(`  ${marker} ${target.padEnd(10)} ${relPath}${exists ? "" : "  (not present)"}`);
      }
      console.log("");
      console.log(ui.dim("Run `haive bridges sync --all` to generate all targets."));
    });
}
