import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  draftsFromFindings,
  filterNewDrafts,
  loadMemoriesFromDir,
  memoryFilePath,
  parseFindings,
  serializeMemory,
  type FindingSeverity,
  type MemoryDraft,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const IngestFindingsInputSchema = {
  format: z.enum(["sarif", "sonar"]).describe("Report format: 'sarif' (ESLint/Semgrep/CodeQL) or 'sonar' (SonarQube issues JSON)"),
  report_path: z
    .string()
    .optional()
    .describe("Project-relative path to the findings JSON file. Provide this OR `report`."),
  report: z
    .string()
    .optional()
    .describe("Inline findings JSON content. Provide this OR `report_path`."),
  type: z
    .enum(["gotcha", "convention"])
    .default("gotcha")
    .describe("Memory type for the created drafts"),
  scope: z
    .enum(["personal", "team", "module"])
    .default("team")
    .describe("Visibility scope for the created memories"),
  module: z.string().optional().describe("Module name (required when scope=module)"),
  min_severity: z
    .enum(["info", "minor", "major", "critical", "blocker"])
    .optional()
    .describe("Ignore findings below this severity"),
  include_stylistic: z
    .boolean()
    .optional()
    .describe("Also ingest auto-fixable stylistic rules (semi/quotes/prefer-const…); off by default as low-value noise"),
  limit: z.number().int().positive().optional().describe("Cap the number of memories created"),
  author: z.string().optional().describe("Author handle or email"),
  dry_run: z
    .boolean()
    .default(false)
    .describe("When true, return the drafts that WOULD be created without writing them"),
};

export type IngestFindingsInput = {
  [K in keyof typeof IngestFindingsInputSchema]: z.infer<(typeof IngestFindingsInputSchema)[K]>;
};

export interface IngestFindingsOutput {
  format: string;
  parsed: number;
  new: number;
  skipped_existing: number;
  dry_run: boolean;
  created: Array<{
    id: string;
    topic: string;
    path: string;
    rule: string;
    severity: FindingSeverity;
    has_sensor: boolean;
    file_path?: string;
  }>;
  notice: string;
}

export async function ingestFindings(
  input: IngestFindingsInput,
  ctx: HaiveContext,
): Promise<IngestFindingsOutput> {
  if (!existsSync(ctx.paths.haiveDir)) {
    throw new Error(`No .ai/ directory at ${ctx.paths.root}. Run 'haive init' first.`);
  }

  let raw: string;
  if (input.report && input.report.trim()) {
    raw = input.report;
  } else if (input.report_path) {
    const file = path.resolve(ctx.paths.root, input.report_path);
    if (!existsSync(file)) throw new Error(`Report file not found: ${file}`);
    raw = await readFile(file, "utf8");
  } else {
    throw new Error("Provide either `report_path` or `report`.");
  }

  const findings = parseFindings(input.format, raw);
  const drafts = draftsFromFindings(findings, {
    type: input.type,
    scope: input.scope,
    module: input.module,
    author: input.author,
    ...(input.min_severity ? { minSeverity: input.min_severity } : {}),
    ...(input.include_stylistic ? { includeStylistic: true } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  });

  const existing = existsSync(ctx.paths.memoriesDir)
    ? await loadMemoriesFromDir(ctx.paths.memoriesDir)
    : [];
  const existingTopics = new Set(
    existing.map(({ memory }) => memory.frontmatter.topic).filter((t): t is string => Boolean(t)),
  );
  const fresh = filterNewDrafts(drafts, existingTopics);
  const skipped = drafts.length - fresh.length;

  const created: IngestFindingsOutput["created"] = [];
  for (const draft of fresh) {
    let filePath: string | undefined;
    if (!input.dry_run) filePath = await writeDraft(ctx, draft);
    created.push({
      id: draft.frontmatter.id,
      topic: draft.topic,
      path: draft.finding.path,
      rule: draft.finding.ruleId,
      severity: draft.finding.severity,
      has_sensor: draft.has_sensor,
      ...(filePath ? { file_path: filePath } : {}),
    });
  }

  const notice = input.dry_run
    ? `Dry run — ${fresh.length} memory(ies) would be created (status=proposed). Re-run with dry_run=false to write them.`
    : `Created ${fresh.length} proposed memory(ies). They are NOT validated and their sensors are warn-only — review with mem_pending and promote with 'haive sensors promote'.`;

  return {
    format: input.format,
    parsed: drafts.length,
    new: fresh.length,
    skipped_existing: skipped,
    dry_run: input.dry_run,
    created,
    notice,
  };
}

async function writeDraft(ctx: HaiveContext, draft: MemoryDraft): Promise<string> {
  const file = memoryFilePath(
    ctx.paths,
    draft.frontmatter.scope,
    draft.frontmatter.id,
    draft.frontmatter.module,
  );
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, serializeMemory({ frontmatter: draft.frontmatter, body: draft.body }), "utf8");
  return file;
}
