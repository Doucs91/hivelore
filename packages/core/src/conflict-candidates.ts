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
