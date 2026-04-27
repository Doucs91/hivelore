import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProjectRoot, resolveHaivePaths, type MemoryScope, type MemoryType } from "@hiveai/core";
import { loadMemoriesFromDir, type LoadedMemory } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface ListOptions {
  scope?: MemoryScope;
  type?: MemoryType;
  tag?: string;
  module?: string;
  status?: string;
  showRejected?: boolean;
  dir?: string;
}

export function registerMemoryList(memory: Command): void {
  memory
    .command("list")
    .description("List memories with optional filters")
    .option("--scope <scope>", "personal | team | module")
    .option("--type <type>", "filter by type")
    .option("--tag <tag>", "filter by tag")
    .option("--module <name>", "filter by module name")
    .option("--status <csv>", "filter by status (draft,proposed,validated,stale,rejected,deprecated)")
    .option("--show-rejected", "include rejected memories (hidden by default)")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: ListOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No memories directory at ${paths.memoriesDir}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const statusFilter = opts.status ? opts.status.split(",").map((s) => s.trim()) : null;
      const filtered = all.filter((m) => {
        if (!matchesFilters(m, opts)) return false;
        const status = m.memory.frontmatter.status;
        if (!opts.showRejected && status === "rejected") return false;
        if (statusFilter && !statusFilter.includes(status)) return false;
        return true;
      });

      if (filtered.length === 0) {
        ui.info("No memories match the filters.");
        const rejectedCount = all.filter((m) => m.memory.frontmatter.status === "rejected").length;
        if (rejectedCount > 0 && !opts.showRejected) {
          ui.info(`(${rejectedCount} rejected hidden — use --show-rejected to include)`);
        }
        return;
      }

      for (const { memory: mem, filePath } of filtered) {
        const fm = mem.frontmatter;
        const tagStr = fm.tags.length ? ui.dim(` [${fm.tags.join(", ")}]`) : "";
        const moduleStr = fm.module ? ui.dim(` (${fm.module})`) : "";
        const statusBadge = ui.statusBadge(fm.status);
        console.log(
          `${ui.bold(fm.id)} ${ui.dim(fm.scope)}/${ui.dim(fm.type)} ${statusBadge}${moduleStr}${tagStr}`,
        );
        console.log(`  ${ui.dim(path.relative(root, filePath))}`);
      }
      console.log(ui.dim(`\n${filtered.length} memor${filtered.length === 1 ? "y" : "ies"}`));

      const draftCount = filtered.filter((m) => m.memory.frontmatter.status === "draft").length;
      if (draftCount > 0) {
        console.log(
          ui.dim(
            `ℹ ${draftCount} in draft — use \`haive memory approve <id>\` to activate or \`haive memory promote <id>\` to share with team`,
          ),
        );
      }
    });
}

function matchesFilters(loaded: LoadedMemory, opts: ListOptions): boolean {
  const fm = loaded.memory.frontmatter;
  if (opts.scope && fm.scope !== opts.scope) return false;
  if (opts.type && fm.type !== opts.type) return false;
  if (opts.tag && !fm.tags.includes(opts.tag)) return false;
  if (opts.module && fm.module !== opts.module) return false;
  return true;
}
