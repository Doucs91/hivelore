/**
 * haive session end — save a structured end-of-session recap.
 *
 * Uses topic-upsert: one recap per scope is kept and updated in-place.
 * get_briefing automatically surfaces the latest recap at the next session start.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  buildFrontmatter,
  findProjectRoot,
  loadMemoriesFromDir,
  memoryFilePath,
  resolveHaivePaths,
  serializeMemory,
  type MemoryFrontmatter,
  type MemoryScope,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface SessionEndOptions {
  goal: string;
  accomplished: string;
  discoveries?: string;
  files?: string;
  next?: string;
  scope?: MemoryScope;
  module?: string;
  dir?: string;
}

function buildRecapBody(opts: SessionEndOptions): string {
  const lines: string[] = [];
  lines.push(`## Goal\n${opts.goal}`);
  lines.push(`\n## Accomplished\n${opts.accomplished}`);
  if (opts.discoveries?.trim()) {
    lines.push(`\n## Discoveries & surprises\n${opts.discoveries}`);
  }
  const filesTouched = parseCsv(opts.files);
  if (filesTouched.length > 0) {
    lines.push(`\n## Files touched\n${filesTouched.map((f) => `- \`${f}\``).join("\n")}`);
  }
  if (opts.next?.trim()) {
    lines.push(`\n## Next steps\n${opts.next}`);
  }
  return lines.join("\n");
}

function recapTopic(scope: string, module?: string): string {
  return module ? `session-recap-${scope}-${module}` : `session-recap-${scope}`;
}

export function registerSessionEnd(session: Command): void {
  session
    .command("end")
    .description("Save a structured end-of-session recap (goal / accomplished / discoveries / next steps)")
    .requiredOption("--goal <text>", "What you were trying to accomplish (1–2 sentences)")
    .requiredOption("--accomplished <text>", "What was actually done (bullet list recommended)")
    .option("--discoveries <text>", "Bugs, surprises, or inconsistencies found during this session")
    .option("--files <csv>", "Key files touched, comma-separated")
    .option("--next <text>", "What should happen next (for the next session or a teammate)")
    .option("--scope <scope>", "personal | team | module", "personal")
    .option("--module <name>", "module name (required when scope=module)")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SessionEndOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);

      if (!existsSync(paths.haiveDir)) {
        ui.error(`No .ai/ found at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const scope = opts.scope ?? "personal";
      const body = buildRecapBody(opts);
      const topic = recapTopic(scope, opts.module);
      const filesTouched = parseCsv(opts.files);

      // Warn about paths that don't exist in project
      const missingPaths = filesTouched.filter((p) => !existsSync(path.resolve(root, p)));
      if (missingPaths.length > 0) {
        ui.warn(`Anchor path${missingPaths.length > 1 ? "s" : ""} not found in project (will be stale):`);
        for (const p of missingPaths) ui.warn(`  ✗ ${p}`);
      }

      // ── Topic upsert ────────────────────────────────────────────────
      if (existsSync(paths.memoriesDir)) {
        const existing = await loadMemoriesFromDir(paths.memoriesDir);
        const topicMatch = existing.find(({ memory }) =>
          memory.frontmatter.topic === topic &&
          memory.frontmatter.scope === scope &&
          (!opts.module || memory.frontmatter.module === opts.module),
        );

        if (topicMatch) {
          const fm = topicMatch.memory.frontmatter;
          const revisionCount = (fm.revision_count ?? 0) + 1;
          const newFrontmatter: MemoryFrontmatter = {
            ...fm,
            revision_count: revisionCount,
            anchor: {
              ...fm.anchor,
              paths: filesTouched.length ? filesTouched : fm.anchor.paths,
            },
          };
          await writeFile(topicMatch.filePath, serializeMemory({ frontmatter: newFrontmatter, body }), "utf8");
          ui.success(`Session recap updated (revision #${revisionCount})`);
          ui.info(`id=${fm.id}  file=${path.relative(root, topicMatch.filePath)}`);
          return;
        }
      }

      // ── Create first recap ──────────────────────────────────────────
  const frontmatter = buildFrontmatter({
    type: "session_recap",
    slug: "recap",
    scope,
    module: opts.module,
    tags: ["session", "recap"],
    paths: filesTouched,
    topic,
    status: "validated",
  });

      const file = memoryFilePath(paths, frontmatter.scope, frontmatter.id, frontmatter.module);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");

      ui.success(`Session recap created`);
      ui.info(`id=${frontmatter.id}  scope=${scope}  file=${path.relative(root, file)}`);
      ui.info("Next session: call \`get_briefing\` — the recap will be surfaced automatically.");
    });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
