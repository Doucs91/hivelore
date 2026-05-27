/**
 * haive session end — save a structured end-of-session recap.
 *
 * Uses topic-upsert: one recap per scope is kept and updated in-place.
 * get_briefing automatically surfaces the latest recap at the next session start.
 */
import { writeFile, mkdir, readFile, rm } from "node:fs/promises";
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
  goal?: string;
  accomplished?: string;
  discoveries?: string;
  files?: string;
  next?: string;
  scope?: MemoryScope;
  module?: string;
  dir?: string;
  auto?: boolean;
  quiet?: boolean;
}

interface Observation {
  ts: string;
  session_id?: string;
  cwd?: string;
  tool: string;
  summary: string;
  files?: string[];
}

async function buildAutoRecap(
  paths: ReturnType<typeof resolveHaivePaths>,
): Promise<{ goal: string; accomplished: string; files: string[]; rawCount: number } | null> {
  const obsFile = path.join(paths.haiveDir, ".cache", "observations.jsonl");
  if (!existsSync(obsFile)) return null;
  const raw = await readFile(obsFile, "utf8").catch(() => "");
  if (!raw.trim()) return null;
  const lines = raw.split("\n").filter(Boolean);
  const obs: Observation[] = [];
  for (const line of lines) {
    try { obs.push(JSON.parse(line) as Observation); } catch { /* skip */ }
  }
  if (obs.length === 0) return null;

  const toolCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();
  const summaries: string[] = [];
  for (const o of obs) {
    toolCounts.set(o.tool, (toolCounts.get(o.tool) ?? 0) + 1);
    for (const f of o.files ?? []) fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
    if (summaries.length < 10) summaries.push(`- ${o.summary}`);
  }

  const topTools = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t, c]) => `${t} ×${c}`)
    .join(", ");
  const topFiles = [...fileCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);

  const goal = `Auto-captured session — ${obs.length} tool calls (${topTools})`;
  const accomplished = summaries.length
    ? `Recent activity:\n${summaries.join("\n")}`
    : `Activity captured but no parseable summaries.`;

  return {
    goal,
    accomplished,
    files: topFiles.map(([f]) => f),
    rawCount: obs.length,
  };
}

function buildRecapBody(opts: {
  goal: string;
  accomplished: string;
  discoveries?: string;
  files?: string;
  next?: string;
}): string {
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
    .description(
      "Save an end-of-session recap so the NEXT session starts with fresh context.\n\n" +
      "  One recap per scope is kept and updated in-place (topic-upsert). The next\n" +
      "  session's get_briefing (or haive briefing) shows it at the very top.\n\n" +
      "  In autopilot mode, a minimal recap saves automatically on MCP server exit.\n" +
      "  Calling this manually produces a richer, more actionable recap.\n\n" +
      "  Example:\n" +
      "    haive session end \\\\\n" +
      "      --goal \"Add Stripe webhook handler\" \\\\\n" +
      "      --accomplished \"Implemented webhook endpoint, added idempotency key\" \\\\\n" +
      "      --discoveries \"Missing .env.example entry for STRIPE_WEBHOOK_SECRET\" \\\\\n" +
      "      --files src/payments/WebhookController.ts,src/payments/WebhookService.ts \\\\\n" +
      "      --next \"Add integration tests for webhook signature validation\"\n",
    )
    .option("--goal <text>", "what you were trying to accomplish (1–2 sentences)")
    .option("--accomplished <text>", "what was actually done (bullet list recommended)")
    .option("--discoveries <text>", "bugs, surprises, or inconsistencies found during this session")
    .option("--files <csv>", "key files touched, comma-separated (used as anchor for staleness detection)")
    .option("--next <text>", "what should happen next (for the next session or a teammate)")
    .option("--scope <scope>", "personal | team | module (default: personal)", "personal")
    .option("--module <name>", "module name (required when scope=module)")
    .option("--auto", "synthesize the recap from .ai/.cache/observations.jsonl (used by Claude Code SessionEnd hook)")
    .option("--quiet", "suppress non-error output (for hook use)")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SessionEndOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);

      if (!existsSync(paths.haiveDir)) {
        if (opts.auto || opts.quiet) return; // hook context — silently no-op
        ui.error(`No .ai/ found at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      // Auto mode: derive goal/accomplished/files from captured observations
      let resolvedFiles = opts.files;
      let goal = opts.goal;
      let accomplished = opts.accomplished;
      if (opts.auto) {
        const synth = await buildAutoRecap(paths);
        if (!synth) return; // nothing observed — silently no-op
        goal = goal ?? synth.goal;
        accomplished = accomplished ?? synth.accomplished;
        if (!resolvedFiles && synth.files.length) resolvedFiles = synth.files.join(",");
      }

      if (!goal || !accomplished) {
        if (opts.quiet) return;
        ui.error("session-end requires --goal and --accomplished (or pass --auto with captured observations).");
        process.exitCode = 1;
        return;
      }

      const scope = opts.scope ?? "personal";
      const body = buildRecapBody({
        goal,
        accomplished,
        discoveries: opts.discoveries,
        files: resolvedFiles,
        next: opts.next,
      });
      const topic = recapTopic(scope, opts.module);
      const filesTouched = parseCsv(resolvedFiles);

      // Warn about paths that don't exist in project
      const missingPaths = filesTouched.filter((p) => !existsSync(path.resolve(root, p)));
      if (missingPaths.length > 0 && !opts.quiet) {
        ui.warn(`Anchor path${missingPaths.length > 1 ? "s" : ""} not found in project (will be stale):`);
        for (const p of missingPaths) ui.warn(`  ✗ ${p}`);
      }

      const cleanupObservations = async (): Promise<void> => {
        if (!opts.auto) return;
        const obsFile = path.join(paths.haiveDir, ".cache", "observations.jsonl");
        if (existsSync(obsFile)) await rm(obsFile).catch(() => { /* non-fatal */ });
      };

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
            verified_at: new Date().toISOString(),
            revision_count: revisionCount,
            anchor: {
              ...fm.anchor,
              paths: filesTouched.length ? filesTouched : fm.anchor.paths,
            },
          };
          await writeFile(topicMatch.filePath, serializeMemory({ frontmatter: newFrontmatter, body }), "utf8");
          await cleanupObservations();
          if (!opts.quiet) {
            ui.success(`Session recap updated (revision #${revisionCount})`);
            ui.info(`id=${fm.id}  file=${path.relative(root, topicMatch.filePath)}`);
            ui.info("Tip: `haive stats --export-report` generates a usage JSON suitable for dashboards.");
          }
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
      await cleanupObservations();

      if (!opts.quiet) {
        ui.success(`Session recap created`);
        ui.info(`id=${frontmatter.id}  scope=${scope}  file=${path.relative(root, file)}`);
        ui.info("Next session: call `get_briefing` — the recap will be surfaced automatically.");
        ui.info("Tip: export a local MCP usage rollup with `haive stats --export-report .ai/tool-usage-roi-report.json`.");
      }
    });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
