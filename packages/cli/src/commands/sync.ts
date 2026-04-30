import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  DEFAULT_AUTO_PROMOTE_RULE,
  findProjectRoot,
  getUsage,
  isAutoPromoteEligible,
  isDecaying,
  loadCodeMap,
  loadMemoriesFromDir,
  loadUsageIndex,
  resolveHaivePaths,
  serializeMemory,
  verifyAnchor,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

const BRIDGE_START = "<!-- haive:memories-start -->";
const BRIDGE_END = "<!-- haive:memories-end -->";

interface SyncOptions {
  dir?: string;
  quiet?: boolean;
  since?: string;
  verify?: boolean;
  promote?: boolean;
  injectBridge?: boolean;
  bridgeFile?: string;
  bridgeMaxMemories?: string;
  embed?: boolean;
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
    .option(
      "--inject-bridge",
      "inject top validated memories into CLAUDE.md (or --bridge-file) between <!-- haive:memories-start/end --> markers",
    )
    .option("--bridge-file <path>", "bridge file to inject into (default: CLAUDE.md)")
    .option("--bridge-max-memories <n>", "max memories to inject into bridge file", "5")
    .option("--embed", "rebuild embeddings index after sync (requires @haive/embeddings)")
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
          // session_recap records historical context — staleness doesn't apply.
          // If one was incorrectly stale-marked by a prior sync, auto-revalidate it now.
          if (memory.frontmatter.type === "session_recap") {
            if (memory.frontmatter.status === "stale") {
              await writeFile(
                filePath,
                serializeMemory({
                  frontmatter: {
                    ...memory.frontmatter,
                    status: "validated",
                    stale_reason: null,
                    verified_at: new Date().toISOString(),
                  },
                  body: memory.body,
                }),
                "utf8",
              );
              revalidated++;
            }
            continue;
          }
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

      const draftMemories = (await loadMemoriesFromDir(paths.memoriesDir)).filter(
        (m) => m.memory.frontmatter.status === "draft",
      );
      const draftCount = draftMemories.length;

      log(
        `${ui.dim("sync:")} ${staleMarked} stale · ${revalidated} revalidated · ${promoted} promoted${sinceReport ? ` · ${sinceReport.added.length}+/${sinceReport.modified.length}~/${sinceReport.removed.length}- since ${opts.since}` : ""}`,
      );
      if (!opts.quiet && draftCount > 0) {
        log(
          ui.dim(
            `ℹ ${draftCount} memor${draftCount === 1 ? "y" : "ies"} in draft — run \`haive memory approve <id>\` to activate or \`haive memory list --status draft\` to review`,
          ),
        );
      }

      if (opts.injectBridge) {
        const bridgeFile = opts.bridgeFile
          ? path.resolve(opts.bridgeFile)
          : path.join(root, "CLAUDE.md");
        const maxInject = Math.max(1, Number(opts.bridgeMaxMemories ?? 5));
        await injectBridge(bridgeFile, paths.memoriesDir, maxInject, root, opts.quiet);
      }

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

      // Decay report: memories not read in >90 days
      if (!opts.quiet) {
        const allForDecay = await loadMemoriesFromDir(paths.memoriesDir);
        const usageForDecay = await loadUsageIndex(paths);
        const decaying = allForDecay.filter(({ memory }) => {
          const fm = memory.frontmatter;
          if (fm.status === "rejected" || fm.status === "deprecated" || fm.status === "stale") return false;
          const u = getUsage(usageForDecay, fm.id);
          return isDecaying(u, fm.created_at);
        });
        if (decaying.length > 0) {
          log(ui.yellow(`\n⚠  ${decaying.length} memor${decaying.length === 1 ? "y" : "ies"} not read in >90 days (consider reviewing or deprecating):`));
          for (const { memory } of decaying) {
            log(ui.dim(`   ${memory.frontmatter.id}`));
          }
        }
      }

      // ── Auto-refresh code-map if source files changed since it was generated ──
      const existingMap = await loadCodeMap(paths);
      if (existingMap) {
        const mapAge = new Date(existingMap.generated_at).getTime();
        // Check if any tracked source files are newer than the map
        const gitResult = spawnSync(
          "git",
          [
            "diff",
            "--name-only",
            "--diff-filter=ACMR",
            `@{${new Date(mapAge).toISOString()}}..HEAD`,
            "--",
            "*.ts", "*.tsx", "*.js", "*.jsx",
            "*.java", "*.kt",
            "*.py",
            "*.go",
            "*.rs",
            "*.cs",
            "*.php",
          ],
          { cwd: root, encoding: "utf8" },
        );
        const changedSourceFiles = (gitResult.stdout ?? "").trim();
        if (changedSourceFiles.length > 0) {
          // Lazily import the indexer to avoid circular deps
          try {
            const { buildCodeMap, saveCodeMap } = await import("@hiveai/core");
            log(ui.dim("code-map: source files changed — refreshing index…"));
            const newMap = await buildCodeMap(root);
            await saveCodeMap(paths, newMap);
            log(ui.dim(`code-map: refreshed (${Object.keys(newMap.files).length} files)`));
          } catch {
            // Non-fatal — code-map refresh is best-effort
          }
        }
      }

      // --embed: rebuild embeddings index after sync
      if (opts.embed) {
        try {
          const emb = await import("@hiveai/embeddings");
          log(ui.dim("embed: rebuilding index…"));
          const report = await emb.rebuildIndex(paths);
          log(ui.dim(`embed: index rebuilt (${report.added} added, ${report.updated} updated, ${report.removed} removed)`));
        } catch {
          ui.warn("--embed: @hiveai/embeddings not available or index build failed. Run `haive embeddings index` manually.");
        }
      }
    });
}

async function injectBridge(
  bridgeFile: string,
  memoriesDir: string,
  maxMemories: number,
  root: string,
  quiet?: boolean,
): Promise<void> {
  if (!existsSync(memoriesDir)) return;

  const all = await loadMemoriesFromDir(memoriesDir);
  const top = all
    .filter(({ memory }) => {
      const s = memory.frontmatter.status;
      if (memory.frontmatter.type === "session_recap") return false;
      return s === "validated" || s === "proposed";
    })
    .sort((a, b) => {
      const score = (m: typeof a) => {
        const s = m.memory.frontmatter.status;
        return (s === "validated" ? 2 : 1);
      };
      return score(b) - score(a);
    })
    .slice(0, maxMemories);

  const block = top
    .map((m) => {
      const fm = m.memory.frontmatter;
      const unverified = fm.status === "proposed" ? " [UNVERIFIED]" : "";
      return `### ${fm.id} (${fm.scope}/${fm.type})${unverified}\n${m.memory.body.trim()}`;
    })
    .join("\n\n---\n\n");

  const injected =
    `${BRIDGE_START}\n` +
    `<!-- AUTO-GENERATED by haive sync --inject-bridge — do not edit between these markers -->\n\n` +
    block +
    `\n\n${BRIDGE_END}`;

  const fileExists = existsSync(bridgeFile);
  let existing = fileExists ? await readFile(bridgeFile, "utf8") : "";
  // Normalize line endings to avoid \r\n accumulation
  existing = existing.replace(/\r\n/g, "\n");

  const startIdx = existing.indexOf(BRIDGE_START);
  const endIdx = existing.indexOf(BRIDGE_END);

  // Detect partial markers — safer to abort than silently corrupt the file
  if (startIdx !== -1 && endIdx === -1) {
    ui.warn(`${path.relative(root, bridgeFile)}: found ${BRIDGE_START} without ${BRIDGE_END}. Fix the file manually before running --inject-bridge.`);
    return;
  }
  if (startIdx === -1 && endIdx !== -1) {
    ui.warn(`${path.relative(root, bridgeFile)}: found ${BRIDGE_END} without ${BRIDGE_START}. Fix the file manually before running --inject-bridge.`);
    return;
  }

  let updated: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    updated = existing.slice(0, startIdx) + injected + existing.slice(endIdx + BRIDGE_END.length);
  } else {
    if (!fileExists && !quiet) {
      ui.info(`Creating ${path.relative(root, bridgeFile)} with haive memory block.`);
    }
    updated = existing + (existing.endsWith("\n") ? "" : "\n") + "\n" + injected + "\n";
  }

  await writeFile(bridgeFile, updated, "utf8");
  if (!quiet) {
    console.log(
      ui.dim(`bridge: injected ${top.length} memor${top.length === 1 ? "y" : "ies"} into ${path.relative(root, bridgeFile)}`),
    );
  }
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
