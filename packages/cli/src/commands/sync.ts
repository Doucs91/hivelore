import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  DEFAULT_AUTO_PROMOTE_RULE,
  findProjectRoot,
  getUsage,
  isAutoPromoteEligible,
  loadMemoriesFromDir,
  loadUsageIndex,
  resolveHaivePaths,
  serializeMemory,
  verifyAnchor,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface SyncOptions {
  dir?: string;
  quiet?: boolean;
  since?: string;
  verify?: boolean;
  promote?: boolean;
}

export function registerSync(program: Command): void {
  program
    .command("sync")
    .description("Refresh memory state after a pull/merge: verify anchors, auto-promote, report changes")
    .option("-d, --dir <dir>", "project root")
    .option("--quiet", "minimal output (suitable for git hooks)")
    .option(
      "--since <ref>",
      "git ref/commit to compare against; report memories added/modified/removed since",
    )
    .option("--no-verify", "skip the anchor verification step")
    .option("--no-promote", "skip the auto-promotion step")
    .action(async (opts: SyncOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        if (!opts.quiet) ui.warn(`No .ai/memories at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const log = (msg: string): void => {
        if (!opts.quiet) console.log(msg);
      };

      let staleMarked = 0;
      let revalidated = 0;
      let promoted = 0;

      if (opts.verify !== false) {
        const memories = await loadMemoriesFromDir(paths.memoriesDir);
        for (const { memory, filePath } of memories) {
          const isAnchored =
            memory.frontmatter.anchor.paths.length > 0 ||
            memory.frontmatter.anchor.symbols.length > 0;
          if (!isAnchored) continue;

          const result = await verifyAnchor(memory, { projectRoot: root });
          const verifiedAt = new Date().toISOString();

          if (result.stale) {
            if (memory.frontmatter.status !== "stale") {
              await writeFile(
                filePath,
                serializeMemory({
                  frontmatter: {
                    ...memory.frontmatter,
                    status: "stale",
                    verified_at: verifiedAt,
                    stale_reason: result.reason,
                  },
                  body: memory.body,
                }),
                "utf8",
              );
              staleMarked++;
            }
          } else if (memory.frontmatter.status === "stale") {
            await writeFile(
              filePath,
              serializeMemory({
                frontmatter: {
                  ...memory.frontmatter,
                  status: "validated",
                  verified_at: verifiedAt,
                  stale_reason: null,
                },
                body: memory.body,
              }),
              "utf8",
            );
            revalidated++;
          }
        }
      }

      if (opts.promote !== false) {
        const memories = await loadMemoriesFromDir(paths.memoriesDir);
        const usage = await loadUsageIndex(paths);
        for (const { memory, filePath } of memories) {
          if (
            isAutoPromoteEligible(
              memory.frontmatter,
              getUsage(usage, memory.frontmatter.id),
              DEFAULT_AUTO_PROMOTE_RULE,
            )
          ) {
            await writeFile(
              filePath,
              serializeMemory({
                frontmatter: { ...memory.frontmatter, status: "validated" },
                body: memory.body,
              }),
              "utf8",
            );
            promoted++;
          }
        }
      }

      const sinceReport = opts.since ? collectSinceChanges(root, opts.since) : null;

      log(
        `${ui.dim("sync:")} ${staleMarked} stale · ${revalidated} revalidated · ${promoted} promoted${sinceReport ? ` · ${sinceReport.added.length}+/${sinceReport.modified.length}~/${sinceReport.removed.length}- since ${opts.since}` : ""}`,
      );

      if (sinceReport && !opts.quiet) {
        if (sinceReport.added.length > 0) {
          log(ui.bold("\nNew memories:"));
          for (const f of sinceReport.added) log(`  + ${f}`);
        }
        if (sinceReport.modified.length > 0) {
          log(ui.bold("\nModified:"));
          for (const f of sinceReport.modified) log(`  ~ ${f}`);
        }
        if (sinceReport.removed.length > 0) {
          log(ui.bold("\nRemoved:"));
          for (const f of sinceReport.removed) log(`  - ${f}`);
        }
      }
    });
}

interface SinceReport {
  added: string[];
  modified: string[];
  removed: string[];
}

function collectSinceChanges(root: string, ref: string): SinceReport | null {
  const result = spawnSync(
    "git",
    ["-C", root, "diff", "--name-status", "--diff-filter=AMD", `${ref}...HEAD`, "--", ".ai/memories"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return null;

  const report: SinceReport = { added: [], modified: [], removed: [] };
  for (const line of result.stdout.split("\n")) {
    const [status, ...rest] = line.split("\t");
    const file = rest.join("\t").trim();
    if (!file) continue;
    if (status === "A") report.added.push(file);
    else if (status === "M") report.modified.push(file);
    else if (status === "D") report.removed.push(file);
  }
  return report;
}
