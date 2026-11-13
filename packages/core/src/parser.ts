import matter from "gray-matter";
import { z } from "zod";
import { MemoryFrontmatterSchema, SENSOR_KINDS } from "./schema.js";
import type { Activation, Memory, MemoryFrontmatter, Sensor } from "./types.js";

const PRIVATE_BLOCK_RE = /<private>[\s\S]*?<\/private>/g;

export function stripPrivate(body: string): string {
  return body.replace(PRIVATE_BLOCK_RE, "").trimEnd();
}

/**
 * Turn a ZodError on the frontmatter into ONE actionable sentence naming the field, the offending
 * value, and — for an enum — the allowed values. A raw ZodError serializes as a multi-line JSON
 * array, so `err.message.split("\n")[0]` (how the loader records the failure) collapsed to a bare
 * `[`, which surfaced in `hivelore doctor` as the meaningless `([)`. A lost corpus file must say
 * WHY it is invisible, or the lesson is lost without a fixable signal.
 */
function formatFrontmatterError(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "invalid frontmatter";
  const field = issue.path.length > 0 ? issue.path.join(".") : "frontmatter";
  if (issue.code === "invalid_enum_value") {
    const got = JSON.stringify((issue as z.ZodInvalidEnumValueIssue).received);
    const allowed = (issue as z.ZodInvalidEnumValueIssue).options.join(" | ");
    return `invalid ${field}: ${got} is not a supported value — expected one of: ${allowed}`;
  }
  return `invalid ${field}: ${issue.message}`;
}

const KNOWN_SENSOR_KINDS = new Set<string>(SENSOR_KINDS);

export function parseMemory(raw: string): Memory {
  const parsed = matter(raw);
  const data = { ...(parsed.data as Record<string, unknown>) };
  // Forward compatibility: a sensor kind from a newer Hivelore is set aside, not fatal.
  const sensor = data["sensor"];
  if (sensor && typeof sensor === "object" && !Array.isArray(sensor)) {
    const kind = (sensor as Record<string, unknown>)["kind"];
    if (typeof kind === "string" && !KNOWN_SENSOR_KINDS.has(kind)) {
      data["unsupported_sensor"] = sensor;
      delete data["sensor"];
    }
  }
  const result = MemoryFrontmatterSchema.safeParse(data);
  if (!result.success) {
    throw new Error(formatFrontmatterError(result.error));
  }
  return {
    frontmatter: result.data,
    body: stripPrivate(parsed.content.trim()),
  };
}

function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Never fold long scalars. js-yaml folds any string past 80 columns into a `>-` block, which is
 * valid YAML but was misread by every line-based consumer — the GitHub Action took `>-` itself as an
 * anchor path and reported "anchor paths missing" for files that existed, and a hand-unfolded file
 * was folded again by the next `mem_update` (field report #10 §1). One line per scalar keeps the
 * file canonical, greppable and diff-stable.
 */
const YAML_DUMP_OPTIONS = { lineWidth: -1 } as const;

/** "2026-05-07-gotcha-flyway-no-modify" → "Gotcha Flyway No Modify" — the canonical fallback title. */
export function titleFromMemoryId(id: string): string {
  return id
    .replace(/^\d{4}-\d{2}-\d{2}-/, "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * The canonical body: every memory opens with a Markdown heading.
 *
 * The heading used to be added AFTER the fact — by the autopilot lint repair during `sync` — so a
 * memory saved, committed and merged came back minutes later with a `# Title Cased Slug` line the
 * agent never wrote, a dirty worktree, and a `finish` that refused to close until one more PR
 * committed it (field reports #10 §2, #12 §6). Writing the final form at save time makes every later
 * normalization a no-op.
 */
export function canonicalMemoryBody(id: string, body: string): string {
  const trimmed = body.trim();
  if (/^#{1,3}\s+\S/m.test(trimmed)) return body;
  const title = titleFromMemoryId(id) || id;
  return trimmed ? `# ${title}\n\n${trimmed}` : `# ${title}`;
}

/**
 * Frontmatter fields whose schema default carries no information. Writing them made every memory
 * open with a wall of `null`/`false`/`0` lines — 4,567 frontmatter lines against 2,092 lines of
 * knowledge in one corpus (field report #12 §3.3). The parser restores the defaults, so omitting
 * them is lossless; a non-default value is always written.
 */
const OMIT_WHEN_DEFAULT: ReadonlyArray<[string, unknown]> = [
  ["expires_when", null],
  ["verified_at", null],
  ["stale_reason", null],
  ["last_read_at", null],
  ["requires_human_approval", false],
  ["validated_by", null],
  ["revision_count", 0],
];

function isEmptyArray(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0;
}

function dropDefaults(frontmatter: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...frontmatter };
  for (const [key, value] of OMIT_WHEN_DEFAULT) if (out[key] === value) delete out[key];
  if (isEmptyArray(out["related_ids"])) delete out["related_ids"];
  const sensor = out["sensor"];
  if (sensor && typeof sensor === "object" && !Array.isArray(sensor)) {
    const next = { ...(sensor as Record<string, unknown>) };
    if (next["autogen"] === false) delete next["autogen"];
    if (next["last_fired"] === null) delete next["last_fired"];
    out["sensor"] = next;
  }
  return out;
}

export function serializeMemory(memory: Memory): string {
  const clean = dropDefaults(stripUndefined(memory.frontmatter) as Record<string, unknown>);
  // Write a preserved newer-kind sensor back where it came from.
  if (clean["unsupported_sensor"]) {
    if (!clean["sensor"]) clean["sensor"] = clean["unsupported_sensor"];
    delete clean["unsupported_sensor"];
  }
  const body = canonicalMemoryBody(memory.frontmatter.id, memory.body);
  return matter.stringify(body, clean, YAML_DUMP_OPTIONS as unknown as matter.GrayMatterOption<string, never>);
}

/**
 * The author's calendar date. A memory saved at 23:00 in Montréal was named after tomorrow's UTC
 * date, and the agent's `git add` with today's date failed (field review 2026-09-30 §3.6).
 * `created_at` keeps the exact UTC instant.
 */
function localCalendarDate(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function newMemoryId(type: string, slug: string, date = new Date()): string {
  const isoDate = localCalendarDate(date);
  // Transliterate instead of dropping accented letters: "décision prix" → "decision-prix", not "d-cision-prix".
  const safeSlug = slug
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${isoDate}-${type}-${safeSlug}`;
}

export function buildFrontmatter(input: {
  type: MemoryFrontmatter["type"];
  slug: string;
  scope?: MemoryFrontmatter["scope"];
  module?: string;
  tags?: string[];
  domain?: string;
  author?: string;
  paths?: string[];
  symbols?: string[];
  commit?: string;
  topic?: string;
  status?: MemoryFrontmatter["status"];
  relatedIds?: string[];
  sensor?: Sensor;
  activation?: Activation;
  lifecycle?: MemoryFrontmatter["lifecycle"];
  evidence?: MemoryFrontmatter["evidence"];
  checks?: MemoryFrontmatter["checks"];
  supersedes?: string[];
  rule?: string;
  source?: string;
  verifiedBy?: string;
  cannotDetect?: string;
}): MemoryFrontmatter {
  const now = new Date();
  const id = newMemoryId(input.type, input.slug, now);
  return MemoryFrontmatterSchema.parse({
    id,
    scope: input.scope ?? "personal",
    module: input.module,
    type: input.type,
    status: input.status ?? "draft",
    anchor: {
      commit: input.commit,
      paths: input.paths ?? [],
      symbols: input.symbols ?? [],
    },
    tags: input.tags ?? [],
    domain: input.domain,
    author: input.author,
    created_at: now.toISOString(),
    expires_when: null,
    topic: input.topic,
    sensor: input.sensor,
    activation: input.activation,
    lifecycle: input.lifecycle,
    evidence: input.evidence,
    checks: input.checks,
    supersedes: input.supersedes,
    rule: input.rule?.trim() || undefined,
    source: input.source?.trim() || undefined,
    verified_by: input.verifiedBy?.trim() || undefined,
    cannot_detect: input.cannotDetect?.trim() || undefined,
    revision_count: 0,
    related_ids: input.relatedIds ?? [],
  });
}
