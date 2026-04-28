import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  buildFrontmatter,
  findProjectRoot,
  memoryFilePath,
  resolveHaivePaths,
  serializeMemory,
  type MemoryScope,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface TriedOptions {
  what: string;
  whyFailed: string;
  instead?: string;
  scope?: MemoryScope;
  module?: string;
  tags?: string;
  paths?: string;
  author?: string;
  dir?: string;
}

export function registerMemoryTried(memory: Command): void {
  memory
    .command("tried")
    .description(
      "Record a failed approach — negative knowledge to prevent repeated AI mistakes",
    )
    .requiredOption("--what <text>", "what approach was tried")
    .requiredOption("--why-failed <text>", "why it failed or should NOT be used")
    .option("--instead <text>", "recommended alternative")
    .option("--scope <scope>", "personal | team | module", "personal")
    .option("--module <name>", "module name (required when scope=module)")
    .option("--tags <csv>", "comma-separated tags")
    .option("--paths <csv>", "anchor paths, comma-separated")
    .option("--author <author>", "author email or handle")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: TriedOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) {
        ui.error(`No .ai/ found at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const slug = opts.what
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .split(/\s+/)
        .slice(0, 5)
        .join("-");

      const baseFm = buildFrontmatter({
        type: "attempt",
        slug,
        scope: opts.scope,
        module: opts.module,
        tags: parseCsv(opts.tags),
        paths: parseCsv(opts.paths),
        author: opts.author,
      });
      // attempt memories are immediately validated — no review cycle needed
      const frontmatter = { ...baseFm, status: "validated" as const };

      const lines: string[] = [`# ${opts.what}`, ""];
      lines.push(`**Why it failed / do NOT use:** ${opts.whyFailed}`);
      if (opts.instead) {
        lines.push("", `**Instead, use:** ${opts.instead}`);
      }
      const body = lines.join("\n") + "\n";

      const file = memoryFilePath(paths, frontmatter.scope, frontmatter.id, frontmatter.module);
      await mkdir(path.dirname(file), { recursive: true });

      if (existsSync(file)) {
        ui.error(`Memory already exists at ${file}`);
        process.exitCode = 1;
        return;
      }

      await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");
      ui.success(`Recorded: ${path.relative(root, file)}`);
      ui.info(`id=${frontmatter.id}  type=attempt  status=validated (auto-approved)`);
    });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
