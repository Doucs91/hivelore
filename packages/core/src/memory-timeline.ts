import type { LoadedMemory } from "./loader.js";
import { pathsOverlap } from "./relevance.js";

function anchorPathsOverlap(
  fmA: LoadedMemory["memory"]["frontmatter"],
  fmB: LoadedMemory["memory"]["frontmatter"],
): boolean {
  for (const a of fmA.anchor.paths) {
    for (const b of fmB.anchor.paths) {
      if (pathsOverlap(a, b)) return true;
    }
  }
  return false;
}

export function firstMemoryOneLine(body: string): string {
  const heading = body.match(/^\s*#\s+(.+)$/m)?.[1]?.trim();
  const line =
    heading ??
    body
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0);
  return (line ?? "").slice(0, 280);
}

export interface TimelineEntry {
  id: string;
  type: string;
  scope: string;
  created_at: string;
  one_line: string;
  topic?: string;
}

export interface CollectTimelineOpts {
  memoryId?: string;
  topic?: string;
  limit: number;
}

/**
 * Memories related by id seed (related_ids, shared topic, anchor overlap) or by topic alone.
 */
export function collectTimelineEntries(
  all: LoadedMemory[],
  opts: CollectTimelineOpts,
): { entries: TimelineEntry[]; notice?: string } {
  if (!opts.memoryId && !opts.topic) {
    return { entries: [], notice: "Provide memory_id and/or topic" };
  }

  const byId = new Map(all.map((l) => [l.memory.frontmatter.id, l]));

  if (opts.topic && !opts.memoryId) {
    const matches = all.filter((l) => l.memory.frontmatter.topic === opts.topic);
    matches.sort((a, b) =>
      a.memory.frontmatter.created_at.localeCompare(b.memory.frontmatter.created_at),
    );
    return {
      entries: matches.slice(0, opts.limit).map((l) => toEntry(l)),
    };
  }

  const seed = byId.get(opts.memoryId!);
  if (!seed) {
    return { entries: [], notice: `No memory with id "${opts.memoryId}"` };
  }

  const collected = new Set<string>();
  const add = (id: string) => {
    if (byId.has(id)) collected.add(id);
  };

  add(seed.memory.frontmatter.id);
  for (const rid of seed.memory.frontmatter.related_ids) add(rid);

  const seedTopic = seed.memory.frontmatter.topic;
  if (seedTopic) {
    for (const l of all) {
      if (l.memory.frontmatter.topic === seedTopic) add(l.memory.frontmatter.id);
    }
  }

  for (const l of all) {
    if (anchorPathsOverlap(seed.memory.frontmatter, l.memory.frontmatter)) {
      add(l.memory.frontmatter.id);
    }
  }

  const firstHop = [...collected];
  for (const id of firstHop) {
    const m = byId.get(id);
    if (!m) continue;
    for (const rid of m.memory.frontmatter.related_ids) add(rid);
  }

  let sorted = [...collected]
    .map((id) => byId.get(id)!)
    .filter(Boolean)
    .sort((a, b) =>
      a.memory.frontmatter.created_at.localeCompare(b.memory.frontmatter.created_at),
    );

  if (opts.topic) {
    sorted = sorted.filter((l) => l.memory.frontmatter.topic === opts.topic);
  }

  return {
    entries: sorted.slice(0, opts.limit).map((l) => toEntry(l)),
  };
}

function toEntry(l: LoadedMemory): TimelineEntry {
  const fm = l.memory.frontmatter;
  const base: TimelineEntry = {
    id: fm.id,
    type: fm.type,
    scope: fm.scope,
    created_at: fm.created_at,
    one_line: firstMemoryOneLine(l.memory.body),
  };
  if (fm.topic !== undefined && fm.topic !== "") {
    return { ...base, topic: fm.topic };
  }
  return base;
}
