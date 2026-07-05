/**
 * CI USAGE — integrate hivelore ingest in your pipeline:
 *
 *   # ESLint / any SARIF emitter
 *   eslint --format @microsoft/eslint-formatter-sarif --output-file eslint.sarif src/
 *   hivelore ingest --from sarif eslint.sarif --scope team --min-severity major
 *
 *   # SonarQube file export
 *   hivelore ingest --from sonar sonar-issues.json --scope team --min-severity major
 *
 *   # SonarQube live API (no file needed — Node 18+)
 *   hivelore ingest --from sonar-api \
 *     --sonar-url "$SONAR_HOST_URL" --sonar-token "$SONAR_TOKEN" \
 *     --sonar-component my_project --min-severity major
 *
 *   # Dry-run to preview without writing
 *   hivelore ingest --from sarif report.sarif --dry-run
 *
 * Exit codes: 0 = success (even when nothing new), 1 = bad args or unreadable report.
 * New memories are status=proposed; a human validates them with `hivelore memory pending`.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  appendProposedRetrievalCases,
  draftsFromFindings,
  filterNewDrafts,
  findProjectRoot,
  loadMemoriesFromDir,
  memoryFilePath,
  extractReviewLearnings,
  parseFindings,
  resolveHaivePaths,
  reviewLearningsToDrafts,
  serializeMemory,
  type FindingSeverity,
  type MemoryDraft,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

interface IngestOptions {
  from?: "sarif" | "sonar" | "sonar-api" | "eslint" | "npm-audit" | "github-pr";
  dryRun?: boolean;
  scope?: "personal" | "team" | "module";
  module?: string;
  type?: "gotcha" | "convention";
  minSeverity?: FindingSeverity;
  includeStylistic?: boolean;
  limit?: string;
  author?: string;
  json?: boolean;
  sonarUrl?: string;
  sonarToken?: string;
  sonarComponent?: string;
  sonarBranch?: string;
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
      "  `sonar-api` fetches issues live over plain HTTPS from any SonarQube/SonarCloud instance —\n" +
      "  no MCP or special setup required, just a URL + token you provide (or SONAR_HOST_URL /\n" +
      "  SONAR_TOKEN env). If you don't use it, file-based ingest works exactly the same.\n\n" +
      "  Example:\n" +
      "    hivelore ingest --from eslint eslint-report.json --min-severity major\n" +
      "    hivelore ingest --from npm-audit audit.json --scope team\n" +
      "    hivelore ingest --from sarif report.sarif --dry-run\n" +
      "    hivelore ingest --from sonar sonar-issues.json --scope team --min-severity major\n" +
      "    hivelore ingest --from sonar-api --sonar-component my_project --min-severity major\n\n" +
      "  Generate the input reports:\n" +
      "    eslint -f json -o eslint-report.json .      # --from eslint\n" +
      "    npm audit --json > audit.json               # --from npm-audit\n\n" +
      "  Review learnings (the PR loop — a reviewer reply becomes a proposed memory):\n" +
      "    hivelore ingest --from github-pr 123          # fetches review threads via gh\n" +
      "    hivelore ingest --from github-pr comments.json --dry-run\n" +
      "    Kept: human replies that read as instructions (never/always/must/prefer…) or carry\n" +
      "    the explicit marker (reply \`/hivelore remember <rule>\` on the thread).\n",
    )
    .argument("[file]", "findings report JSON — or, for --from github-pr, a PR number/URL (fetched via gh) or a recorded comments JSON")
    .requiredOption("--from <format>", "report format: sarif | sonar | sonar-api | eslint | npm-audit | github-pr")
    .option("--dry-run", "show what would be created without writing", false)
    .option("--scope <scope>", "memory scope: personal | team | module", "team")
    .option("--module <name>", "module name (required when scope=module)")
    .option("--type <type>", "memory type: gotcha | convention", "gotcha")
    .option("--min-severity <severity>", "ignore findings below this severity (info|minor|major|critical|blocker)")
    .option("--include-stylistic", "also ingest auto-fixable stylistic rules (semi/quotes/prefer-const…); off by default as low-value noise", false)
    .option("--limit <n>", "cap the number of memories created")
    .option("--author <author>", "author email or handle")
    .option("--json", "emit JSON", false)
    .option("--sonar-url <url>", "SonarQube base URL for --from sonar-api (or env SONAR_HOST_URL)")
    .option("--sonar-token <token>", "SonarQube token for --from sonar-api (or env SONAR_TOKEN)")
    .option("--sonar-component <key>", "SonarQube project/component key for --from sonar-api")
    .option("--sonar-branch <branch>", "optional SonarQube branch for --from sonar-api")
    .option("-d, --dir <dir>", "project root")
    .action(async (file: string | undefined, opts: IngestOptions) => {
      const format = opts.from;
      const VALID_FORMATS = ["sarif", "sonar", "sonar-api", "eslint", "npm-audit", "github-pr"] as const;
      if (!format || !(VALID_FORMATS as readonly string[]).includes(format)) {
        ui.error(`--from must be one of: ${VALID_FORMATS.join(", ")}`);
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
        ui.error(`No .ai/ found at ${root}. Run \`hivelore init\` first.`);
        process.exitCode = 1;
        return;
      }

      // `sonar-api` parses with the same Sonar reader; only the source differs (HTTP vs file).
      // github-pr never reaches parseFindings (it has its own converter below) — cast is safe.
      const parseFormat = (format === "sonar-api" ? "sonar" : format) as "sarif" | "sonar" | "eslint" | "npm-audit";

      let raw: string;
      if (format === "github-pr") {
        if (!file) {
          ui.error("--from github-pr needs a PR number/URL or a recorded comments JSON file.");
          process.exitCode = 1;
          return;
        }
        const asPath = path.resolve(root, file);
        if (existsSync(asPath)) {
          raw = await readFile(asPath, "utf8");
        } else {
          const fetched = await fetchPrReviewComments(root, file);
          if (!fetched.ok) {
            ui.error(fetched.error);
            process.exitCode = 1;
            return;
          }
          raw = fetched.json;
        }
      } else if (format === "sonar-api") {
        const fetched = await fetchSonarIssues(opts);
        if (!fetched.ok) {
          ui.error(fetched.error);
          process.exitCode = 1;
          return;
        }
        raw = fetched.json;
      } else {
        if (!file) {
          ui.error(`--from ${format} needs a report file argument, e.g. \`hivelore ingest --from ${format} report.json\`.`);
          process.exitCode = 1;
          return;
        }
        const reportPath = path.resolve(root, file);
        if (!existsSync(reportPath)) {
          ui.error(`Report file not found: ${reportPath}`);
          process.exitCode = 1;
          return;
        }
        try {
          raw = await readFile(reportPath, "utf8");
        } catch (err) {
          ui.error(`Could not read ${reportPath}: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }
      }

      let drafts: MemoryDraft[];
      let findingsCount = 0;
      if (format === "github-pr") {
        try {
          const payload = JSON.parse(raw) as unknown;
          findingsCount = Array.isArray(payload) ? payload.length : 0;
          const learnings = extractReviewLearnings(payload);
          drafts = reviewLearningsToDrafts(learnings, {
            scope: opts.scope ?? "team",
            module: opts.module,
            author: opts.author,
            ...(opts.limit ? { limit: Math.max(0, Number.parseInt(opts.limit, 10) || 0) } : {}),
          });
        } catch (err) {
          ui.error(`Failed to parse the PR comments payload: ${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }
      } else try {
        const findings = parseFindings(parseFormat, raw, { cwd: root });
        findingsCount = findings.length;
        drafts = draftsFromFindings(findings, {
          type: opts.type ?? "gotcha",
          scope: opts.scope ?? "team",
          module: opts.module,
          author: opts.author,
          ...(opts.minSeverity ? { minSeverity: opts.minSeverity } : {}),
          ...(opts.includeStylistic ? { includeStylistic: true } : {}),
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
          if (format === "github-pr") await appendReviewGoldenCases(root, fresh);
        }
        console.log(
          JSON.stringify(
            {
              format,
              findings: findingsCount,
              parsed: drafts.length,
              filtered_low_value: Math.max(0, findingsCount - drafts.length),
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

      const filteredLowValue = Math.max(0, findingsCount - drafts.length);
      console.log(
        ui.bold(
          `Hivelore ingest (${format}) — ${findingsCount} finding(s), ${fresh.length} new` +
          (filteredLowValue > 0 ? `, ${filteredLowValue} low-value/stylistic filtered` : "") +
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
      if (format === "github-pr") await appendReviewGoldenCases(root, fresh);
      ui.success(`Created ${created} proposed memory(ies) under ${path.relative(root, paths.memoriesDir)}/`);
      ui.info("Review with `hivelore memory pending`; promote sensors with `hivelore sensors promote <id> --yes`.");
    });
}

async function writeDraft(paths: ReturnType<typeof resolveHaivePaths>, draft: MemoryDraft): Promise<string> {
  const file = memoryFilePath(paths, draft.frontmatter.scope, draft.frontmatter.id, draft.frontmatter.module);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, serializeMemory({ frontmatter: draft.frontmatter, body: draft.body }), "utf8");
  return file;
}

async function appendReviewGoldenCases(root: string, drafts: MemoryDraft[]): Promise<void> {
  if (drafts.length === 0) return;
  const specFile = path.join(root, ".ai", "eval", "spec.json");
  const current = existsSync(specFile) ? await readFile(specFile, "utf8") : null;
  const cases = drafts.map((draft) => ({
    name: `review-learning:${draft.topic}`,
    task: draft.finding.message,
    ...(draft.finding.path ? { files: [draft.finding.path] } : {}),
    expect_ids: [draft.frontmatter.id],
  }));
  await mkdir(path.dirname(specFile), { recursive: true });
  await writeFile(specFile, appendProposedRetrievalCases(current, cases), "utf8");
}

type SonarFetchResult = { ok: true; json: string } | { ok: false; error: string };

/**
 * Fetch open issues from any SonarQube / SonarCloud instance over plain HTTPS, using the
 * SonarQube Web API (`/api/issues/search`). This is deliberately MCP-free and dependency-free
 * (Node's built-in fetch) so Hivelore works on any project: credentials are supplied by the user
 * via flags or env, and when they are absent this returns a clear error instead of crashing —
 * file-based ingest (`--from sonar|sarif`) is always available regardless.
 */
async function fetchSonarIssues(opts: IngestOptions): Promise<SonarFetchResult> {
  const baseUrl = (opts.sonarUrl ?? process.env.SONAR_HOST_URL ?? "").trim().replace(/\/+$/, "");
  const token = (opts.sonarToken ?? process.env.SONAR_TOKEN ?? "").trim();
  const component = (opts.sonarComponent ?? "").trim();

  if (!baseUrl) {
    return { ok: false, error: "--from sonar-api needs --sonar-url (or env SONAR_HOST_URL)." };
  }
  if (!token) {
    return { ok: false, error: "--from sonar-api needs --sonar-token (or env SONAR_TOKEN)." };
  }
  if (!component) {
    return { ok: false, error: "--from sonar-api needs --sonar-component <projectKey>." };
  }
  if (typeof fetch !== "function") {
    return { ok: false, error: "global fetch is unavailable — Node 18+ is required for --from sonar-api." };
  }

  const params = new URLSearchParams({ componentKeys: component, resolved: "false", ps: "500" });
  if (opts.sonarBranch) params.set("branch", opts.sonarBranch);
  const url = `${baseUrl}/api/issues/search?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? " (check the token and its permissions)" : "";
      return { ok: false, error: `SonarQube API returned ${res.status} ${res.statusText}${hint}.` };
    }
    const json = await res.text();
    return { ok: true, json };
  } catch (err) {
    return {
      ok: false,
      error: `Could not reach SonarQube at ${baseUrl}: ${err instanceof Error ? err.message : String(err)}. File-based ingest (--from sonar) still works.`,
    };
  }
}

type PrFetchResult = { ok: true; json: string } | { ok: false; error: string };

/**
 * Fetch both review-thread and top-level PR comments. GitHub emits `/hivelore remember` through
 * either pull_request_review_comment or issue_comment; ingesting only one endpoint made the
 * acknowledgement lie for top-level comments.
 * gh supplies auth and pagination; when it is missing or unauthenticated the error says exactly
 * that — a recorded JSON file works identically for offline/CI use.
 */
async function fetchPrReviewComments(root: string, ref: string): Promise<PrFetchResult> {
  const numberMatch = ref.match(/^(\d+)$/) ?? ref.match(/\/pull\/(\d+)/);
  if (!numberMatch) {
    return { ok: false, error: `"${ref}" is neither a comments JSON file, a PR number, nor a PR URL.` };
  }
  const prNumber = numberMatch[1];
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  try {
    const fetchPages = async (endpoint: string): Promise<unknown[]> => {
      const { stdout } = await run(
        "gh",
        ["api", endpoint, "--paginate", "--slurp"],
        { cwd: root, maxBuffer: 16 * 1024 * 1024 },
      );
      const pages = JSON.parse(stdout) as unknown;
      return Array.isArray(pages) ? pages.flatMap((page) => Array.isArray(page) ? page : []) : [];
    };
    const [reviewComments, issueComments] = await Promise.all([
      fetchPages(`repos/{owner}/{repo}/pulls/${prNumber}/comments`),
      fetchPages(`repos/{owner}/{repo}/issues/${prNumber}/comments`),
    ]);
    const normalizedIssueComments = issueComments.map((row) => ({
      ...(row as Record<string, unknown>),
      pull_request_url: `https://api.github.com/repos/{owner}/{repo}/pulls/${prNumber}`,
    }));
    return { ok: true, json: JSON.stringify([...reviewComments, ...normalizedIssueComments]) };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    return {
      ok: false,
      error:
        `Could not fetch PR #${prNumber} comments via gh: ${(e.stderr || e.message || String(err)).slice(0, 200)}. ` +
        "Install/authenticate the gh CLI, or pass a recorded comments JSON file instead.",
    };
  }
}
