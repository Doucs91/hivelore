import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  deriveConfidence,
  findProjectRoot,
  getUsage,
  loadUsageIndex,
  resolveHaivePaths,
} from "@hivelore/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface ShowOptions {
  raw?: boolean;
  dir?: string;
}

export function registerMemoryShow(memory: Command): void {
  memory
    .command("get <id>")
    .alias("show")
    .description("Print a memory's frontmatter, body, and confidence/usage. Mirrors MCP mem_get. Alias: show")
    .option("--raw", "print the raw file contents instead of a summary")
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: ShowOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const found = all.find((m) => m.memory.frontmatter.id === id);
      if (!found) {
        ui.error(`No memory with id "${id}".`);
        process.exitCode = 1;
        return;
      }

      if (opts.raw) {
        console.log(await readFile(found.filePath, "utf8"));
        return;
      }

      const fm = found.memory.frontmatter;
      const usage = await loadUsageIndex(paths);
      const u = getUsage(usage, fm.id);
      const conf = deriveConfidence(fm, u);

      console.log(ui.bold(fm.id));
      console.log(`${ui.dim("scope:")}      ${fm.scope}${fm.module ? ` / ${fm.module}` : ""}`);
      console.log(`${ui.dim("type:")}       ${fm.type}`);
      console.log(`${ui.dim("status:")}     ${fm.status}  ${ui.dim("→ confidence:")} ${ui.bold(conf)}`);
      console.log(`${ui.dim("tags:")}       ${fm.tags.length ? fm.tags.join(", ") : "(none)"}`);
      console.log(`${ui.dim("created:")}    ${fm.created_at}`);
      if (fm.verified_at) console.log(`${ui.dim("verified:")}   ${fm.verified_at}`);
      if (fm.stale_reason) console.log(`${ui.dim("stale:")}      ${fm.stale_reason}`);
      console.log(`${ui.dim("reads:")}      ${u.read_count}  ${ui.dim("rejections:")} ${u.rejected_count}`);
      console.log(`${ui.dim("file:")}       ${path.relative(root, found.filePath)}`);
      if (fm.anchor.paths.length || fm.anchor.symbols.length) {
        console.log(ui.dim("anchor:"));
        if (fm.anchor.commit) console.log(`  ${ui.dim("commit:")}  ${fm.anchor.commit}`);
        if (fm.anchor.paths.length)
          console.log(`  ${ui.dim("paths:")}   ${fm.anchor.paths.join(", ")}`);
        if (fm.anchor.symbols.length)
          console.log(`  ${ui.dim("symbols:")} ${fm.anchor.symbols.join(", ")}`);
      }
      console.log();
      console.log(found.memory.body);
    });
}
