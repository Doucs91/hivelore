import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  resolveHaivePaths,
  serializeMemory,
  verifyAnchor,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface VerifyOptions {
  id?: string;
  all?: boolean;
  update?: boolean;
  dir?: string;
}

export function registerMemoryVerify(memory: Command): void {
  memory
    .command("verify")
    .description("Check memory anchors against current code, optionally marking stale ones")
    .option("--id <id>", "verify a single memory by id")
    .option("--all", "verify every memory (default if --id is omitted)")
    .option("--update", "write status=stale (or status=validated for re-freshed) back to disk")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: VerifyOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const targets = opts.id
        ? all.filter((m) => m.memory.frontmatter.id === opts.id)
        : all;

      if (opts.id && targets.length === 0) {
        ui.error(`No memory with id "${opts.id}".`);
        process.exitCode = 1;
        return;
      }

      let staleCount = 0;
      let freshCount = 0;
      let anchorless = 0;
      let updated = 0;

      for (const { memory: mem, filePath } of targets) {
        const result = await verifyAnchor(mem, { projectRoot: root });
        const isAnchored =
          mem.frontmatter.anchor.paths.length > 0 ||
          mem.frontmatter.anchor.symbols.length > 0;

        if (!isAnchored) {
          anchorless++;
          continue;
        }

        const rel = path.relative(root, filePath);
        if (result.stale) {
          staleCount++;
          console.log(`${ui.bold("STALE")}  ${mem.frontmatter.id}`);
          console.log(`       ${ui.dim(rel)}`);
          console.log(`       ${result.reason}`);
        } else {
          freshCount++;
          console.log(`${ui.dim("fresh")}  ${mem.frontmatter.id}`);
        }

        if (opts.update) {
          const next = applyVerification(mem, result);
          await writeFile(filePath, serializeMemory(next), "utf8");
          updated++;
        }
      }

      const summary = [
        `${freshCount} fresh`,
        `${staleCount} stale`,
        `${anchorless} anchorless (skipped)`,
      ];
      if (opts.update) summary.push(`${updated} updated on disk`);
      ui.info(summary.join(" · "));
    });
}

function applyVerification(
  mem: Parameters<typeof serializeMemory>[0],
  result: { stale: boolean; reason: string | null },
): Parameters<typeof serializeMemory>[0] {
  const verifiedAt = new Date().toISOString();
  if (result.stale) {
    return {
      frontmatter: {
        ...mem.frontmatter,
        status: "stale",
        verified_at: verifiedAt,
        stale_reason: result.reason,
      },
      body: mem.body,
    };
  }
  // Reset stale_reason when re-validating; keep validated/proposed status as is,
  // promote draft→validated when verification passes.
  const nextStatus =
    mem.frontmatter.status === "stale" || mem.frontmatter.status === "draft"
      ? "validated"
      : mem.frontmatter.status;
  return {
    frontmatter: {
      ...mem.frontmatter,
      status: nextStatus,
      verified_at: verifiedAt,
      stale_reason: null,
    },
    body: mem.body,
  };
}
