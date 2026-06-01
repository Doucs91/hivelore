import matter from "gray-matter";
import { MemoryFrontmatterSchema } from "./schema.js";
import type { Memory, MemoryFrontmatter, Sensor } from "./types.js";

const PRIVATE_BLOCK_RE = /<private>[\s\S]*?<\/private>/g;

export function stripPrivate(body: string): string {
  return body.replace(PRIVATE_BLOCK_RE, "").trimEnd();
}

export function parseMemory(raw: string): Memory {
  const parsed = matter(raw);
  const frontmatter = MemoryFrontmatterSchema.parse(parsed.data);
  return {
    frontmatter,
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

export function serializeMemory(memory: Memory): string {
  const clean = stripUndefined(memory.frontmatter) as Record<string, unknown>;
  return matter.stringify(memory.body, clean);
}

export function newMemoryId(type: string, slug: string, date = new Date()): string {
  const isoDate = date.toISOString().slice(0, 10);
  const safeSlug = slug
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
    revision_count: 0,
    related_ids: input.relatedIds ?? [],
  });
}
