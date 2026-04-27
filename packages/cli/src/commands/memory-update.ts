import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  resolveHaivePaths,
  serializeMemory,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface UpdateOptions {
  body?: string;
  tags?: string;
  paths?: string;
  symbols?: string;
  commit?: string;
  domain?: string;
  author?: string;
  dir?: string;
}

export function registerMemoryUpdate(memory: Command): void {
  memory
    .command("update <id>")
    .description("Update body, tags, or anchor of an existing memory (preserves id and usage history)")
    .option("--body <text>", "new Markdown body — replaces the existing body")
    .option("--tags <csv>", "new tags, comma-separated — fully replaces existing tags")
    .option("--paths <csv>", "new anchor paths, comma-separated")
    .option("--symbols <csv>", "new anchor symbols, comma-separated")
    .option("--commit <sha>", "new anchor commit SHA")
    .option("--domain <domain>", "new domain label")
    .option("--author <author>", "new author handle or email")
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: UpdateOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const memories = await loadMemoriesFromDir(paths.memoriesDir);
      const loaded = memories.find((m) => m.memory.frontmatter.id === id);
      if (!loaded) {
        ui.error(`No memory with id "${id}".`);
        process.exitCode = 1;
        return;
      }

      const updated: string[] = [];
      const { frontmatter, body } = loaded.memory;

      const newAnchor = { ...frontmatter.anchor };
      if (opts.paths !== undefined) {
        newAnchor.paths = parseCsv(opts.paths);
        updated.push("anchor.paths");
      }
      if (opts.symbols !== undefined) {
        newAnchor.symbols = parseCsv(opts.symbols);
        updated.push("anchor.symbols");
      }
      if (opts.commit !== undefined) {
        newAnchor.commit = opts.commit;
        updated.push("anchor.commit");
      }

      const newFrontmatter = {
        ...frontmatter,
        anchor: newAnchor,
        ...(opts.tags !== undefined ? { tags: parseCsv(opts.tags) } : {}),
        ...(opts.domain !== undefined ? { domain: opts.domain } : {}),
        ...(opts.author !== undefined ? { author: opts.author } : {}),
      };
      if (opts.tags !== undefined) updated.push("tags");
      if (opts.domain !== undefined) updated.push("domain");
      if (opts.author !== undefined) updated.push("author");

      const newBody = opts.body !== undefined ? opts.body : body;
      if (opts.body !== undefined) updated.push("body");

      if (updated.length === 0) {
        ui.warn("Nothing to update — provide at least one option.");
        return;
      }

      await writeFile(
        loaded.filePath,
        serializeMemory({ frontmatter: newFrontmatter, body: newBody }),
        "utf8",
      );

      ui.success(`Updated ${path.relative(root, loaded.filePath)}`);
      ui.info(`fields: ${updated.join(", ")}`);
    });
}

function parseCsv(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
