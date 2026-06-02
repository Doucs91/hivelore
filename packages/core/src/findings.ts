import type { MemoryFrontmatter } from "./types.js";
import { buildFrontmatter } from "./parser.js";
import { suggestSensorFromMemory } from "./sensor-suggest.js";

/**
 * Findings ingestion — the self-feeding half of the sensors story (feature B).
 *
 * Phase 1/2 turned a documented mistake into an executable `sensor`. But someone still has
 * to *document* the mistake. Findings ingestion closes the review↔memory loop: a real defect
 * reported by a scanner (SonarQube, or any SARIF-emitting tool like ESLint/Semgrep/CodeQL)
 * becomes an anchored `gotcha`/`convention` memory, pre-filled with a conservative autogen
 * sensor, so the *next* agent is steered away from it before it writes the same code.
 *
 * This module is pure: parsers + draft synthesis, no I/O. The CLI (`haive ingest`) and the
 * MCP tool (`ingest_findings`) read files / write memories around these functions.
 *
 * Safety: every draft is `status: proposed` and every suggested sensor is `severity: warn`
 * + `autogen: true`. Ingestion never auto-validates and never auto-blocks (safety rules +
 * `2026-05-07-attempt-strict-precommit-gate-on-haive`). A human promotes both.
 */

export type FindingSeverity = "info" | "minor" | "major" | "critical" | "blocker";

export interface Finding {
  /** Source tool, e.g. "sonar", "eslint", "semgrep". */
  tool: string;
  /** Rule key, e.g. "typescript:S1234" or "no-unused-vars". */
  ruleId: string;
  /** Human-readable description of the problem. */
  message: string;
  severity: FindingSeverity;
  /** Project-relative file path. */
  path: string;
  /** 1-based line number, when known. */
  line?: number;
  /** Offending source snippet, when the report provides one. */
  snippet?: string;
  /**
   * Stable dedup key: `tool:ruleId:path`. Deliberately excludes the line so re-running a
   * scan after unrelated edits (which shift line numbers) does not re-propose the same memory.
   */
  key: string;
}

export interface MemoryDraft {
  key: string;
  /** `ingest:<key>` — used as the memory `topic` so re-ingestion upserts instead of duplicating. */
  topic: string;
  frontmatter: MemoryFrontmatter;
  body: string;
  finding: Finding;
  /** True when a conservative sensor could be derived from the finding. */
  has_sensor: boolean;
}

export interface DraftOptions {
  /** Memory type for the draft. Default "gotcha". */
  type?: "gotcha" | "convention";
  /** Scope for the draft. Default "team". */
  scope?: "personal" | "team" | "module";
  module?: string;
  author?: string;
}

export interface DraftsOptions extends DraftOptions {
  /** Cap on number of drafts produced (after in-batch dedup). */
  limit?: number;
  /** Only ingest findings at or above this severity. Default: none (all). */
  minSeverity?: FindingSeverity;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = {
  info: 0,
  minor: 1,
  major: 2,
  critical: 3,
  blocker: 4,
};

/** Normalize a tool-specific severity string to the shared scale. */
export function normalizeFindingSeverity(raw: string | undefined | null): FindingSeverity {
  const v = (raw ?? "").toString().trim().toLowerCase();
  switch (v) {
    case "blocker":
      return "blocker";
    case "critical":
    case "error":
    case "fatal":
      return "critical";
    case "major":
    case "warning":
    case "warn":
      return "major";
    case "minor":
    case "note":
    case "info":
    case "information":
    case "informational":
      return v === "minor" ? "minor" : "info";
    default:
      return "info";
  }
}

function findingKey(tool: string, ruleId: string, path: string): string {
  return `${tool}:${ruleId}:${path}`;
}

function coerceJson(input: string | unknown): unknown {
  if (typeof input === "string") {
    try {
      return JSON.parse(input);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return input;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Parse SARIF 2.1.0 (`runs[].results[]`). Works for any SARIF emitter (ESLint, Semgrep,
 * CodeQL, etc.). The tool name comes from `runs[].tool.driver.name`.
 */
export function parseSarif(input: string | unknown): Finding[] {
  const doc = asRecord(coerceJson(input));
  const findings: Finding[] = [];
  for (const runRaw of asArray(doc.runs)) {
    const run = asRecord(runRaw);
    const driver = asRecord(asRecord(run.tool).driver);
    const tool = (typeof driver.name === "string" ? driver.name : "sarif").toLowerCase();
    for (const resultRaw of asArray(run.results)) {
      const result = asRecord(resultRaw);
      const ruleId =
        (typeof result.ruleId === "string" && result.ruleId) ||
        (typeof asRecord(result.rule).id === "string" ? (asRecord(result.rule).id as string) : "") ||
        "unknown-rule";
      const message =
        (typeof asRecord(result.message).text === "string"
          ? (asRecord(result.message).text as string)
          : "") || ruleId;
      const severity = normalizeFindingSeverity(typeof result.level === "string" ? result.level : "warning");
      const location = asRecord(asArray(result.locations)[0]);
      const physical = asRecord(location.physicalLocation);
      const artifact = asRecord(physical.artifactLocation);
      const region = asRecord(physical.region);
      const path = typeof artifact.uri === "string" ? normalizeUri(artifact.uri) : "";
      if (!path) continue;
      const line = typeof region.startLine === "number" ? region.startLine : undefined;
      const snippet =
        typeof asRecord(region.snippet).text === "string"
          ? (asRecord(region.snippet).text as string).trim()
          : undefined;
      findings.push({
        tool,
        ruleId,
        message: message.trim(),
        severity,
        path,
        ...(line !== undefined ? { line } : {}),
        ...(snippet ? { snippet } : {}),
        key: findingKey(tool, ruleId, path),
      });
    }
  }
  return findings;
}

/**
 * Parse the SonarQube issues payload (`issues[]` from `/api/issues/search`). The file path
 * lives in `component` as `projectKey:relative/path`; we strip the project key.
 */
export function parseSonar(input: string | unknown): Finding[] {
  const doc = asRecord(coerceJson(input));
  const findings: Finding[] = [];
  for (const issueRaw of asArray(doc.issues)) {
    const issue = asRecord(issueRaw);
    const ruleId = typeof issue.rule === "string" ? issue.rule : "unknown-rule";
    const message = typeof issue.message === "string" ? issue.message.trim() : ruleId;
    // Sonar exposes either `severity` (legacy) or `impacts[].severity` (MQR mode).
    const impacts = asArray(issue.impacts);
    const impactSeverity =
      impacts.length > 0 && typeof asRecord(impacts[0]).severity === "string"
        ? (asRecord(impacts[0]).severity as string)
        : undefined;
    const severity = normalizeFindingSeverity(
      (typeof issue.severity === "string" ? issue.severity : undefined) ?? impactSeverity,
    );
    const component = typeof issue.component === "string" ? issue.component : "";
    const path = componentToPath(component);
    if (!path) continue;
    const line = typeof issue.line === "number" ? issue.line : undefined;
    findings.push({
      tool: "sonar",
      ruleId,
      message,
      severity,
      path,
      ...(line !== undefined ? { line } : {}),
      key: findingKey("sonar", ruleId, path),
    });
  }
  return findings;
}

/** Dispatch to the right parser by declared format. */
export function parseFindings(format: "sarif" | "sonar", input: string | unknown): Finding[] {
  return format === "sonar" ? parseSonar(input) : parseSarif(input);
}

function normalizeUri(uri: string): string {
  return uri.replace(/^file:\/\//, "").replace(/^\.\//, "");
}

function componentToPath(component: string): string {
  const idx = component.indexOf(":");
  return idx === -1 ? component : component.slice(idx + 1);
}

function sanitize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function basename(p: string): string {
  const parts = p.split("/");
  return parts[parts.length - 1] || p;
}

/** Build the markdown body for a finding-derived memory. */
export function findingBody(finding: Finding): string {
  const lines: string[] = [
    `# ${finding.ruleId} in ${finding.path}`,
    "",
    `**Source:** ${finding.tool} finding (severity: ${finding.severity})`,
    "",
    finding.message,
    "",
    `**Location:** ${finding.path}${finding.line !== undefined ? `:${finding.line}` : ""}`,
  ];
  if (finding.snippet) {
    lines.push("", "**Offending code:**", "```", finding.snippet, "```");
  }
  lines.push("", `**Instead, use:** Resolve the ${finding.tool} finding — ${finding.message}`);
  return lines.join("\n") + "\n";
}

/** Convert one finding into a proposed memory draft (with a conservative sensor when derivable). */
export function findingToDraft(finding: Finding, options: DraftOptions = {}): MemoryDraft {
  const type = options.type ?? "gotcha";
  const scope = options.scope ?? "team";
  const topic = `ingest:${finding.key}`;
  const slug = `${sanitize(finding.tool)}-${sanitize(finding.ruleId)}-${sanitize(basename(finding.path))}`;
  const body = findingBody(finding);

  const frontmatter = buildFrontmatter({
    type,
    slug,
    scope,
    module: options.module,
    author: options.author,
    paths: [finding.path],
    tags: ["ingested", finding.tool, finding.severity],
    topic,
    status: "proposed",
  });

  const sensor = suggestSensorFromMemory(body, [finding.path]);
  if (sensor) frontmatter.sensor = sensor;

  return { key: finding.key, topic, frontmatter, body, finding, has_sensor: Boolean(sensor) };
}

/** Convert a batch of findings into drafts, deduped within the batch and capped/filtered. */
export function draftsFromFindings(findings: Finding[], options: DraftsOptions = {}): MemoryDraft[] {
  const minRank = options.minSeverity ? SEVERITY_RANK[options.minSeverity] : -1;
  const seen = new Set<string>();
  const drafts: MemoryDraft[] = [];
  for (const finding of findings) {
    if (SEVERITY_RANK[finding.severity] < minRank) continue;
    if (seen.has(finding.key)) continue;
    seen.add(finding.key);
    drafts.push(findingToDraft(finding, options));
    if (options.limit !== undefined && drafts.length >= options.limit) break;
  }
  return drafts;
}

/** Drop drafts whose topic already exists in the corpus (cross-run dedup). */
export function filterNewDrafts(drafts: MemoryDraft[], existingTopics: Iterable<string>): MemoryDraft[] {
  const existing = new Set(existingTopics);
  return drafts.filter((d) => !existing.has(d.topic));
}
