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
  limit?: string;
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
    .option("--limit <n>", "max memories to display")
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
      const limit = opts.limit ? Math.max(1, parseInt(opts.limit, 10)) : undefined;
      const filtered = all.filter((m) => {
        if (!matchesFilters(m, opts)) return false;
        const status = m.memory.frontmatter.status;
        if (!opts.showRejected && !statusFilter && status === "rejected") return false;
        if (statusFilter && !statusFilter.includes(status)) return false;
        return true;
      });

      // Count hidden rejected (not covered by an explicit status filter)
      const hiddenRejectedCount =
        !opts.showRejected && !statusFilter
          ? all.filter(
              (m) => matchesFilters(m, opts) && m.memory.frontmatter.status === "rejected",
            ).length
          : 0;

      if (filtered.length === 0) {
        ui.info("No memories match the filters.");
        if (hiddenRejectedCount > 0) {
          ui.info(`(${hiddenRejectedCount} rejected hidden — use --show-rejected to include)`);
        }
        return;
      }

      const displayed = limit !== undefined ? filtered.slice(0, limit) : filtered;
      const clipped = filtered.length - displayed.length;

      for (const { memory: mem, filePath } of displayed) {
        const fm = mem.frontmatter;
        const tagStr = fm.tags.length ? ui.dim(` [${fm.tags.join(", ")}]`) : "";
        const moduleStr = fm.module ? ui.dim(` (${fm.module})`) : "";
        const statusBadge = ui.statusBadge(fm.status);
        console.log(
          `${ui.bold(fm.id)} ${ui.dim(fm.scope)}/${ui.dim(fm.type)} ${statusBadge}${moduleStr}${tagStr}`,
        );
        const title = mem.body.match(/^#\s+(.+)$/m)?.[1]?.trim();
        if (title && title !== fm.id) console.log(`  ${title}`);
        console.log(`  ${ui.dim(path.relative(root, filePath))}`);
      }
      const totalLabel = clipped > 0
        ? `\n${displayed.length} of ${filtered.length} memories shown (use --limit to adjust)`
        : `\n${filtered.length} memor${filtered.length === 1 ? "y" : "ies"}`;
      console.log(ui.dim(totalLabel));

      // Always show rejected hint when memories are hidden
      if (hiddenRejectedCount > 0) {
        console.log(
          ui.dim(`(${hiddenRejectedCount} rejected hidden — use --show-rejected to include)`),
        );
      }

      // Draft hint: scope-aware
      const draftItems = filtered.filter((m) => m.memory.frontmatter.status === "draft");
      if (draftItems.length > 0) {
        const hasPersonalDrafts = draftItems.some(
          (m) => m.memory.frontmatter.scope === "personal",
        );
        const hasTeamDrafts = draftItems.some(
          (m) => m.memory.frontmatter.scope !== "personal",
        );
        let hint = `ℹ ${draftItems.length} in draft — use \`haive memory approve <id>\` to activate`;
        if (hasPersonalDrafts && !hasTeamDrafts) {
          hint += " or `haive memory promote <id>` to share with team";
        }
        console.log(ui.dim(hint));
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
