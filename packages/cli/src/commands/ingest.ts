import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  draftsFromFindings,
  filterNewDrafts,
  findProjectRoot,
  loadMemoriesFromDir,
  memoryFilePath,
  parseFindings,
  resolveHaivePaths,
  serializeMemory,
  type FindingSeverity,
  type MemoryDraft,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface IngestOptions {
  from?: "sarif" | "sonar";
  dryRun?: boolean;
  scope?: "personal" | "team" | "module";
  module?: string;
  type?: "gotcha" | "convention";
  minSeverity?: FindingSeverity;
  limit?: string;
  author?: string;
  json?: boolean;
  dir?: string;
}

const SEVERITIES: FindingSeverity[] = ["info", "minor", "major", "critical", "blocker"];

export function registerIngest(program: Command): void {
  program
    .command("ingest")
    .description(
      "Ingest scanner findings (SonarQube / SARIF) as proposed, anchored memories with sensors.\n\n" +
      "  Closes the review↔memory loop: a real defect a scanner found becomes a `gotcha`/`convention`\n" +
      "  memory anchored to the file, pre-filled with a conservative `warn` sensor, so the next agent\n" +
      "  is steered away from it. Drafts are status=proposed; a human validates/promotes them.\n\n" +
      "  Example:\n" +
      "    haive ingest --from sarif eslint.sarif --dry-run\n" +
      "    haive ingest --from sonar sonar-issues.json --scope team --min-severity major\n",
    )
    .argument("<file>", "path to the findings report (JSON)")
    .requiredOption("--from <format>", "report format: sarif | sonar")
    .option("--dry-run", "show what would be created without writing", false)
    .option("--scope <scope>", "memory scope: personal | team | module", "team")
    .option("--module <name>", "module name (required when scope=module)")
    .option("--type <type>", "memory type: gotcha | convention", "gotcha")
    .option("--min-severity <severity>", "ignore findings below this severity (info|minor|major|critical|blocker)")
    .option("--limit <n>", "cap the number of memories created")
    .option("--author <author>", "author email or handle")
    .option("--json", "emit JSON", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (file: string, opts: IngestOptions) => {
      const format = opts.from;
      if (format !== "sarif" && format !== "sonar") {
        ui.error("--from must be sarif or sonar");
        process.exitCode = 1;
        return;
      }
      if (opts.type && opts.type !== "gotcha" && opts.type !== "convention") {
        ui.error("--type must be gotcha or convention");
        process.exitCode = 1;
        return;
      }
      if (opts.minSeverity && !SEVERITIES.includes(opts.minSeverity)) {
        ui.error(`--min-severity must be one of: ${SEVERITIES.join(", ")}`);
        process.exitCode = 1;
        return;
      }

      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) {
        ui.error(`No .ai/ found at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const reportPath = path.resolve(root, file);
      if (!existsSync(reportPath)) {
        ui.error(`Report file not found: ${reportPath}`);
        process.exitCode = 1;
        return;
      }

      let raw: string;
      try {
        raw = await readFile(reportPath, "utf8");
      } catch (err) {
        ui.error(`Could not read ${reportPath}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }

      let drafts: MemoryDraft[];
      try {
        const findings = parseFindings(format, raw);
        drafts = draftsFromFindings(findings, {
          type: opts.type ?? "gotcha",
          scope: opts.scope ?? "team",
          module: opts.module,
          author: opts.author,
          ...(opts.minSeverity ? { minSeverity: opts.minSeverity } : {}),
          ...(opts.limit ? { limit: Math.max(0, Number.parseInt(opts.limit, 10) || 0) } : {}),
        });
      } catch (err) {
        ui.error(`Failed to parse ${format} report: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
        return;
      }

      // Cross-run dedup: skip findings already ingested (same `ingest:<key>` topic).
      const existing = existsSync(paths.memoriesDir) ? await loadMemoriesFromDir(paths.memoriesDir) : [];
      const existingTopics = new Set(
        existing.map(({ memory }) => memory.frontmatter.topic).filter((t): t is string => Boolean(t)),
      );
      const fresh = filterNewDrafts(drafts, existingTopics);
      const skipped = drafts.length - fresh.length;

      if (opts.json) {
        const created: string[] = [];
        if (!opts.dryRun) {
          for (const draft of fresh) created.push(await writeDraft(paths, draft));
        }
        console.log(
          JSON.stringify(
            {
              format,
              parsed: drafts.length,
              new: fresh.length,
              skipped_existing: skipped,
              dry_run: Boolean(opts.dryRun),
              drafts: fresh.map((d) => ({
                id: d.frontmatter.id,
                topic: d.topic,
                path: d.finding.path,
                rule: d.finding.ruleId,
                severity: d.finding.severity,
                has_sensor: d.has_sensor,
              })),
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(
        ui.bold(
          `hAIve ingest (${format}) — ${drafts.length} finding(s), ${fresh.length} new` +
          (skipped > 0 ? `, ${skipped} already ingested` : ""),
        ),
      );
      if (fresh.length === 0) {
        ui.info("Nothing to ingest.");
        return;
      }

      for (const draft of fresh) {
        const sensorTag = draft.has_sensor ? ui.dim(" +sensor") : "";
        console.log(
          `  • ${draft.finding.ruleId} ${ui.dim(`(${draft.finding.severity})`)} → ${draft.finding.path}${sensorTag}`,
        );
        if (opts.dryRun) console.log(`     ${ui.dim("would create:")} ${draft.frontmatter.id}`);
      }

      if (opts.dryRun) {
        ui.info(`Dry run — nothing written. Re-run without --dry-run to create ${fresh.length} proposed memory(ies).`);
        return;
      }

      let created = 0;
      for (const draft of fresh) {
        await writeDraft(paths, draft);
        created++;
      }
      ui.success(`Created ${created} proposed memory(ies) under ${path.relative(root, paths.memoriesDir)}/`);
      ui.info("Review with `haive memory pending`; promote sensors with `haive sensors promote <id> --yes`.");
    });
}

async function writeDraft(paths: ReturnType<typeof resolveHaivePaths>, draft: MemoryDraft): Promise<string> {
  const file = memoryFilePath(paths, draft.frontmatter.scope, draft.frontmatter.id, draft.frontmatter.module);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, serializeMemory({ frontmatter: draft.frontmatter, body: draft.body }), "utf8");
  return file;
}
