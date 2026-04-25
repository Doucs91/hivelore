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
  type MemoryType,
} from "@haive/core";
import { ui } from "../utils/ui.js";

interface AddOptions {
  type: MemoryType;
  slug: string;
  scope?: MemoryScope;
  module?: string;
  tags?: string;
  domain?: string;
  author?: string;
  paths?: string;
  symbols?: string;
  commit?: string;
  body?: string;
  dir?: string;
}

export function registerMemoryAdd(memory: Command): void {
  memory
    .command("add")
    .description("Add a new memory (defaults to personal scope — v0.1 approach B)")
    .requiredOption("--type <type>", "convention | decision | gotcha | architecture | glossary")
    .requiredOption("--slug <slug>", "short identifier used in the file name")
    .option("--scope <scope>", "personal | team | module", "personal")
    .option("--module <name>", "module name (required when scope=module)")
    .option("--tags <csv>", "comma-separated tags")
    .option("--domain <domain>", "domain (e.g. transactions)")
    .option("--author <author>", "author email or handle")
    .option("--paths <csv>", "anchor paths, comma-separated")
    .option("--symbols <csv>", "anchor symbols, comma-separated")
    .option("--commit <sha>", "anchor commit SHA")
    .option("--body <text>", "memory body content (Markdown)")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: AddOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) {
        ui.error(`No .ai/ found at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const frontmatter = buildFrontmatter({
        type: opts.type,
        slug: opts.slug,
        scope: opts.scope,
        module: opts.module,
        tags: parseCsv(opts.tags),
        domain: opts.domain,
        author: opts.author,
        paths: parseCsv(opts.paths),
        symbols: parseCsv(opts.symbols),
        commit: opts.commit,
      });

      const body = opts.body ?? `# ${opts.slug}\n\nTODO — write the memory body.\n`;
      const file = memoryFilePath(paths, frontmatter.scope, frontmatter.id, frontmatter.module);
      await mkdir(path.dirname(file), { recursive: true });

      if (existsSync(file)) {
        ui.error(`Memory already exists at ${file}`);
        process.exitCode = 1;
        return;
      }

      await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");
      ui.success(`Created ${path.relative(root, file)}`);
      ui.info(`scope=${frontmatter.scope} status=${frontmatter.status} id=${frontmatter.id}`);
    });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
