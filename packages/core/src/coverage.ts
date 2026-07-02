/**
 * Harness coverage-gap detection — "which churny files have NO team knowledge on them?".
 *
 * Hivelore's `eval` synthesizes cases from the memories that EXIST (does the corpus surface
 * correctly?). It cannot tell you what knowledge is MISSING. This module answers the inverse,
 * proactive question Fowler frames as an open challenge: of the files the team edits most, which
 * carry no covering decision/convention/gotcha/architecture memory? Those are the blind spots
 * where a confident agent is most likely to violate an unwritten rule.
 *
 * Pure: the caller supplies hot files (from git history / briefing-radar) and the loaded corpus.
 */
import type { LoadedMemory } from "./loader.js";

/** Where a file's "heat" came from: committed git churn, agent edits this/recent sessions, or both. */
export type HotFileSource = "git" | "agent" | "both";

export interface HotFile {
  path: string;
  /** Number of times the file changed in the lookback window (the "heat"). */
  changes: number;
  /** Provenance of the heat. Optional for back-compat with git-only callers. */
  source?: HotFileSource;
}

export interface CoverageGap {
  path: string;
  changes: number;
  /** Provenance of the heat that made this file a blind spot. */
  source?: HotFileSource;
}

export interface CoverageOptions {
  /** Only flag files with at least this many changes. Default 3. */
  minChanges?: number;
  /** Memory types that count as "covering" a file. Default decision/convention/gotcha/architecture. */
  coveringTypes?: string[];
  /** Cap on returned gaps. Default 20. */
  limit?: number;
}

const DEFAULT_COVERING_TYPES = ["decision", "convention", "gotcha", "architecture"];

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/g, "");
}

/**
 * Build the set of path prefixes the corpus covers: every anchor path of a non-dead,
 * non-recap covering memory. A file is covered if it equals, or sits under, one of them.
 */
export function buildCoverageIndex(
  memories: LoadedMemory[],
  coveringTypes: string[] = DEFAULT_COVERING_TYPES,
): Set<string> {
  const types = new Set(coveringTypes);
  const covered = new Set<string>();
  for (const { memory } of memories) {
    const fm = memory.frontmatter;
    if (!types.has(fm.type)) continue;
    if (fm.status === "stale" || fm.status === "deprecated" || fm.status === "rejected") continue;
    for (const p of fm.anchor.paths) {
      const norm = normalizePath(p);
      if (norm) covered.add(norm);
    }
  }
  return covered;
}

/** True when `file` equals or is nested under any covered path prefix. */
export function isCovered(file: string, coverage: Set<string>): boolean {
  const target = normalizePath(file);
  if (coverage.has(target)) return true;
  for (const scope of coverage) {
    if (target === scope || target.startsWith(`${scope}/`)) return true;
  }
  return false;
}

/**
 * Cross hot files with the coverage index → the uncovered, frequently-edited files.
 * Highest heat first. These are the highest-value places to add a memory or sensor.
 */
export function findCoverageGaps(
  hotFiles: HotFile[],
  memories: LoadedMemory[],
  options: CoverageOptions = {},
): CoverageGap[] {
  const minChanges = options.minChanges ?? 3;
  const limit = options.limit ?? 20;
  const coverage = buildCoverageIndex(memories, options.coveringTypes);

  const gaps: CoverageGap[] = [];
  for (const hot of hotFiles) {
    if (hot.changes < minChanges) continue;
    if (isCovered(hot.path, coverage)) continue;
    gaps.push({ path: normalizePath(hot.path), changes: hot.changes, ...(hot.source ? { source: hot.source } : {}) });
  }
  gaps.sort((a, b) => b.changes - a.changes);
  return gaps.slice(0, limit);
}

/**
 * Tally a flat list of edited file paths into HotFiles — the agent-edit heat signal from the
 * PostToolUse observation log (files agents actually touch), complementary to committed git churn.
 * Pure: the caller reads/normalizes the observation paths.
 */
export function tallyHotFiles(paths: string[], source: HotFileSource = "agent"): HotFile[] {
  const counts = new Map<string, number>();
  for (const raw of paths) {
    const norm = normalizePath(raw);
    if (!norm) continue;
    counts.set(norm, (counts.get(norm) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([path, changes]) => ({ path, changes, source }))
    .sort((a, b) => b.changes - a.changes);
}

/**
 * Merge two HotFile lists, summing heat per path. A file hot in both lists is tagged `both` so the
 * report can show that agents AND git churn both point at the same uncovered file (the strongest gap).
 */
export function mergeHotFiles(a: HotFile[], b: HotFile[]): HotFile[] {
  const merged = new Map<string, HotFile>();
  for (const hot of [...a, ...b]) {
    const norm = normalizePath(hot.path);
    if (!norm) continue;
    const existing = merged.get(norm);
    if (!existing) {
      merged.set(norm, { path: norm, changes: hot.changes, ...(hot.source ? { source: hot.source } : {}) });
      continue;
    }
    existing.changes += hot.changes;
    if (hot.source && existing.source && hot.source !== existing.source) existing.source = "both";
    else existing.source = existing.source ?? hot.source;
  }
  return [...merged.values()].sort((x, y) => y.changes - x.changes);
}
