/**
 * `haive memory resolve-conflict <id_a> <id_b>` — turn a detected contradiction into a resolution.
 *
 * `haive memory conflict-candidates` finds pairs that contradict each other; this APPLIES the fix:
 * it deprecates the losing memory (by the deterministic order in `planConflictResolution`) and
 * stamps it with a stale_reason pointing at the winner. Keeps the corpus coherent as it grows —
 * Fowler's "incoherence at scale" challenge.
 */
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { Command } from "commander";
import {
  findProjectRoot,
  planConflictResolution,
  resolveHaivePaths,
  serializeMemory,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface ResolveConflictOptions {
  yes?: boolean;
  json?: boolean;
  dir?: string;
}

export function registerMemoryResolveConflict(memory: Command): void {
  memory
    .command("resolve-conflict <id_a> <id_b>")
    .description("Resolve a contradiction: keep the stronger memory, deprecate (supersede) the other")
    .option("--yes", "apply the resolution (without this, only previews it)", false)
    .option("--json", "emit JSON", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (idA: string, idB: string, opts: ResolveConflictOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }

      const memories = await loadMemoriesFromDir(paths.memoriesDir);
      const a = memories.find((m) => m.memory.frontmatter.id === idA);
      const b = memories.find((m) => m.memory.frontmatter.id === idB);
      if (!a || !b) {
        ui.error(`Memory not found: ${!a ? idA : ""} ${!b ? idB : ""}`.trim());
        process.exitCode = 1;
        return;
      }

      const plan = planConflictResolution(a, b);
      const loser = plan.supersede_id === idA ? a : b;

      if (opts.json) {
        console.log(JSON.stringify({ ...plan, applied: Boolean(opts.yes) }, null, 2));
      } else {
        console.log(ui.bold("Conflict resolution"));
        console.log(`  keep:      ${ui.green(plan.keep_id)}`);
        console.log(`  supersede: ${ui.red(plan.supersede_id)} ${ui.dim(`→ deprecated`)}`);
        console.log(`  reason:    ${plan.reason}`);
      }

      if (!opts.yes) {
        if (!opts.json) ui.info("Preview only — re-run with --yes to apply.");
        return;
      }

      await writeFile(
        loser.filePath,
        serializeMemory({
          frontmatter: {
            ...loser.memory.frontmatter,
            status: "deprecated",
            stale_reason: plan.stale_reason,
            related_ids: [...new Set([...loser.memory.frontmatter.related_ids, plan.keep_id])],
          },
          body: loser.memory.body,
        }),
        "utf8",
      );
      if (!opts.json) ui.success(`Deprecated ${plan.supersede_id}; ${plan.keep_id} remains authoritative.`);
    });
}
