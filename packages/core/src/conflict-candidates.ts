import type { LoadedMemory } from "./loader.js";

function tokenSetForConflict(loaded: LoadedMemory): Set<string> {
  const fm = loaded.memory.frontmatter;
  const heading = loaded.memory.body.match(/^\s*#\s+(.+)$/m)?.[1] ?? "";
  const blob = `${fm.id} ${heading} ${loaded.memory.body.slice(0, 2000)}`;
  const tokens = blob
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3);
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const uni = a.size + b.size - inter;
  return uni === 0 ? 0 : inter / uni;
}

export interface ConflictCandidatesOpts {
  sinceDays: number;
  types: string[];
  minJaccard: number;
  maxPairs: number;
  /** Hard cap on memories considered ( avoids O(n²) explosions). */
  maxScan: number;
}

export interface ConflictCandidatePair {
  id_a: string;
  id_b: string;
  jaccard: number;
}

export interface TopicStatusPair {
  id_a: string;
  id_b: string;
  topic: string;
  status_a: string;
  status_b: string;
}

/**
 * Same `topic` key with opposed trust (validated vs rejected) — advisory; use `mem_conflicts_with` per id next.
 */
export function findTopicStatusConflictPairs(
  memories: LoadedMemory[],
  maxPairs: number,
): TopicStatusPair[] {
  const byTopic = new Map<string, LoadedMemory[]>();
  for (const l of memories) {
    const topic = l.memory.frontmatter.topic;
    if (!topic || topic.trim() === "") continue;
    const g = byTopic.get(topic);
    if (g) g.push(l);
    else byTopic.set(topic, [l]);
  }
  const out: TopicStatusPair[] = [];
  for (const [topic, group] of byTopic) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length && out.length < maxPairs; i++) {
      for (let j = i + 1; j < group.length && out.length < maxPairs; j++) {
        const sa = group[i]!.memory.frontmatter.status;
        const sb = group[j]!.memory.frontmatter.status;
        if (
          (sa === "validated" && sb === "rejected") ||
          (sa === "rejected" && sb === "validated")
        ) {
          out.push({
            id_a: group[i]!.memory.frontmatter.id,
            id_b: group[j]!.memory.frontmatter.id,
            topic,
            status_a: sa,
            status_b: sb,
          });
        }
      }
    }
  }
  return out;
}

/**
 * Bulk heuristic: lexical similarity pairs for human review → often followed by `mem_conflicts_with`.
 */
export function findLexicalConflictPairs(
  memories: LoadedMemory[],
  opts: ConflictCandidatesOpts,
): { pairs: ConflictCandidatePair[]; scanned: number; truncated: boolean } {
  const cutoff = Date.now() - opts.sinceDays * 86_400_000;
  let pool = memories.filter((l) => {
    const fm = l.memory.frontmatter;
    if (!opts.types.includes(fm.type)) return false;
    const t = Date.parse(fm.created_at);
    return !Number.isNaN(t) && t >= cutoff;
  });
  pool.sort((a, b) =>
    b.memory.frontmatter.created_at.localeCompare(a.memory.frontmatter.created_at),
  );
  let truncated = false;
  if (pool.length > opts.maxScan) {
    pool = pool.slice(0, opts.maxScan);
    truncated = true;
  }
  const sets = pool.map((l) => ({
    id: l.memory.frontmatter.id,
    set: tokenSetForConflict(l),
  }));

  const pairs: ConflictCandidatePair[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const jac = jaccard(sets[i]!.set, sets[j]!.set);
      if (jac >= opts.minJaccard) {
        pairs.push({ id_a: sets[i]!.id, id_b: sets[j]!.id, jaccard: jac });
      }
    }
  }
  pairs.sort((a, b) => b.jaccard - a.jaccard);
  return {
    pairs: pairs.slice(0, opts.maxPairs),
    scanned: pool.length,
    truncated,
  };
}
