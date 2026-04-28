import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  buildFrontmatter,
  findProjectRoot,
  inferModulesFromPaths,
  loadMemoriesFromDir,
  memoryFilePath,
  resolveHaivePaths,
  serializeMemory,
  type MemoryScope,
  type MemoryType,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface AddOptions {
  type: MemoryType;
  slug: string;
  title?: string;
  scope?: MemoryScope;
  module?: string;
  tags?: string;
  domain?: string;
  author?: string;
  paths?: string;
  symbols?: string;
  commit?: string;
  body?: string;
  bodyFile?: string;
  dir?: string;
}

export function registerMemoryAdd(memory: Command): void {
  memory
    .command("add")
    .description("Add a new memory (defaults to personal scope)")
    .requiredOption("--type <type>", "convention | decision | gotcha | architecture | glossary | attempt")
    .requiredOption("--slug <slug>", "short identifier used in the file name")
    .option("--title <text>", "memory title — becomes the first heading of the body")
    .option("--scope <scope>", "personal | team | module", "personal")
    .option("--module <name>", "module name (required when scope=module)")
    .option("--tags <csv>", "comma-separated tags")
    .option("--domain <domain>", "domain (e.g. transactions)")
    .option("--author <author>", "author email or handle")
    .option("--paths <csv>", "anchor paths, comma-separated")
    .option("--symbols <csv>", "anchor symbols, comma-separated")
    .option("--commit <sha>", "anchor commit SHA")
    .option("--body <text>", "memory body content (Markdown) — overrides --title default body")
    .option("--body-file <path>", "read memory body from a Markdown file — alternative to --body for long content")
    .option("--no-auto-tag", "disable automatic tag suggestions inferred from anchor paths")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: AddOptions & { autoTag?: boolean }) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) {
        ui.error(`No .ai/ found at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const userTags = parseCsv(opts.tags);
      const anchorPaths = parseCsv(opts.paths);
      const autoTagsEnabled = opts.autoTag !== false;
      const inferredTags = autoTagsEnabled ? inferModulesFromPaths(anchorPaths) : [];
      const mergedTags = Array.from(new Set([...userTags, ...inferredTags]));

      const frontmatter = buildFrontmatter({
        type: opts.type,
        slug: opts.slug,
        scope: opts.scope,
        module: opts.module,
        tags: mergedTags,
        domain: opts.domain,
        author: opts.author,
        paths: anchorPaths,
        symbols: parseCsv(opts.symbols),
        commit: opts.commit,
      });

      const title = opts.title ?? opts.slug;
      let body: string;
      if (opts.bodyFile !== undefined) {
        if (!existsSync(opts.bodyFile)) {
          ui.error(`--body-file not found: ${opts.bodyFile}`);
          process.exitCode = 1;
          return;
        }
        const fileContent = await readFile(opts.bodyFile, "utf8");
        body = opts.title ? `# ${opts.title}\n\n${fileContent.trim()}\n` : fileContent;
      } else if (opts.body !== undefined) {
        body = opts.title ? `# ${opts.title}\n\n${opts.body}` : opts.body;
      } else {
        body = `# ${title}\n\nTODO — write the memory body.\n`;
      }

      const file = memoryFilePath(paths, frontmatter.scope, frontmatter.id, frontmatter.module);
      await mkdir(path.dirname(file), { recursive: true });

      if (existsSync(file)) {
        ui.error(`Memory already exists at ${file}`);
        process.exitCode = 1;
        return;
      }

      // Dedup check: warn if a similar slug already exists
      if (existsSync(paths.memoriesDir)) {
        const existing = await loadMemoriesFromDir(paths.memoriesDir);
        const slugTokens = opts.slug.toLowerCase().split(/[-_\s]+/).filter(Boolean);
        const similar = existing.filter(({ memory }) => {
          const id = memory.frontmatter.id.toLowerCase();
          return (
            slugTokens.length >= 2 &&
            slugTokens.filter((t) => id.includes(t)).length >= Math.ceil(slugTokens.length * 0.6)
          );
        });
        if (similar.length > 0) {
          ui.warn(`Possible duplicate — similar memories exist: ${similar.map((m) => m.memory.frontmatter.id).join(", ")}`);
          ui.warn("Consider updating one of these with \`haive memory update\` instead.");
        }
      }

      await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");
      ui.success(`Created ${path.relative(root, file)}`);
      ui.info(`id=${frontmatter.id}  scope=${frontmatter.scope}  status=${frontmatter.status}`);
      if (inferredTags.length > 0) {
        ui.info(`auto-tagged: ${inferredTags.join(", ")}  (use --no-auto-tag to disable)`);
      }

      // Workflow hint
      if (frontmatter.scope === "personal") {
        console.log(
          ui.dim(
            `→ next: haive memory approve ${frontmatter.id}  (activate)` +
            `  |  haive memory promote ${frontmatter.id}  (share with team)`,
          ),
        );
      } else {
        console.log(
          ui.dim(`→ next: haive memory approve ${frontmatter.id}  (mark as validated)`),
        );
      }
    });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
