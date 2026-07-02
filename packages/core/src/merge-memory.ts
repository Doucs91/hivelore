/**
 * Deterministic 3-way merge for Hivelore memory files — kills the `.ai/` conflict-marker pain.
 *
 * Several agents + the human edit this repo in parallel with manual pull/push, so the same memory
 * file (especially the topic-upsert session recap, which churns every session) regularly collides
 * and leaves `<<<<<<<` markers under `.ai/`. A normal text merge can't resolve that; but a Hivelore
 * memory has a total order baked into its frontmatter, so we CAN pick a winner deterministically:
 *
 *   1. higher `revision_count` (more topic-upsert refinements) wins
 *   2. else newer `created_at` wins
 *   3. else fall back to "ours" (stable, avoids a hard conflict)
 *
 * Registered as a git merge driver via `.gitattributes` (`*.md merge=haive` under `.ai/memories/`).
 * Pure: the CLI driver reads ours/theirs, calls this, writes the result.
 */
import { parseMemory } from "./parser.js";

export interface MergeResult {
  /** The chosen file content. */
  content: string;
  /** Which side won. */
  winner: "ours" | "theirs";
  /** Why (for logging). */
  reason: string;
}

function safeParse(raw: string): ReturnType<typeof parseMemory> | null {
  try {
    return parseMemory(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve two versions of the same memory file. Returns the winning content and the rationale.
 * Falls back to "ours" when either side can't be parsed (never throws — a merge driver must not).
 */
export function mergeMemoryVersions(ours: string, theirs: string): MergeResult {
  if (ours === theirs) {
    return { content: ours, winner: "ours", reason: "identical" };
  }
  const a = safeParse(ours);
  const b = safeParse(theirs);

  // Unparseable side → keep ours; the driver can still exit cleanly instead of leaving markers.
  if (!a || !b) {
    return { content: ours, winner: "ours", reason: "unparseable side — kept ours" };
  }

  const ra = a.frontmatter.revision_count ?? 0;
  const rb = b.frontmatter.revision_count ?? 0;
  if (ra !== rb) {
    return rb > ra
      ? { content: theirs, winner: "theirs", reason: `higher revision_count (${rb} > ${ra})` }
      : { content: ours, winner: "ours", reason: `higher revision_count (${ra} > ${rb})` };
  }

  const ca = a.frontmatter.created_at ?? "";
  const cb = b.frontmatter.created_at ?? "";
  const cmp = cb.localeCompare(ca);
  if (cmp > 0) return { content: theirs, winner: "theirs", reason: `newer created_at (${cb})` };
  if (cmp < 0) return { content: ours, winner: "ours", reason: `newer created_at (${ca})` };

  return { content: ours, winner: "ours", reason: "tie — kept ours" };
}
