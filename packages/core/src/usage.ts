import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export interface MemoryUsage {
  read_count: number;
  last_read_at: string | null;
  rejected_count: number;
  last_rejected_at: string | null;
  rejection_reason: string | null;
  /**
   * Number of times the memory was explicitly confirmed *useful* — i.e. an agent
   * or human recorded that it changed what they did (the closed-loop "applied"
   * outcome, recorded via `mem_feedback`). A far stronger utility signal than a
   * read: a memory can be surfaced many times and ignored, but `applied` means it
   * demonstrably steered work. Drives impact scoring in {@link ./impact.js}.
   */
  applied_count: number;
  last_applied_at: string | null;
  /**
   * Number of *prevention* events — times this memory's sensor actually fired on a scanned diff,
   * intercepting a known mistake before it landed. This is an OUTCOME signal (defect prevented),
   * the closest proxy hAIve has to "did the knowledge stop a real problem?", distinct from
   * retrieval (read) and self-reported usefulness (applied). Recorded by `haive sensors check`.
   */
  prevented_count: number;
  last_prevented_at: string | null;
}

export interface UsageIndex {
  version: 1;
  updated_at: string;
  by_id: Record<string, MemoryUsage>;
}

export const USAGE_FILE = "usage.json";

export function emptyUsage(): MemoryUsage {
  return {
    read_count: 0,
    last_read_at: null,
    rejected_count: 0,
    last_rejected_at: null,
    rejection_reason: null,
    applied_count: 0,
    last_applied_at: null,
    prevented_count: 0,
    last_prevented_at: null,
  };
}

/**
 * Normalize a possibly-partial stored usage record (older `usage.json` files
 * predate the `applied_*` fields). Always returns a full {@link MemoryUsage}.
 */
function normalizeUsage(stored: Partial<MemoryUsage> | undefined): MemoryUsage {
  return { ...emptyUsage(), ...(stored ?? {}) };
}

export function emptyUsageIndex(): UsageIndex {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    by_id: {},
  };
}

export function usagePath(paths: HaivePaths): string {
  return path.join(paths.haiveDir, ".cache", USAGE_FILE);
}

export async function loadUsageIndex(paths: HaivePaths): Promise<UsageIndex> {
  const file = usagePath(paths);
  if (!existsSync(file)) return emptyUsageIndex();
  const raw = await readFile(file, "utf8");
  try {
    const parsed = JSON.parse(raw) as UsageIndex;
    if (parsed.version !== 1) return emptyUsageIndex();
    return parsed;
  } catch {
    return emptyUsageIndex();
  }
}

export async function saveUsageIndex(paths: HaivePaths, index: UsageIndex): Promise<void> {
  const file = usagePath(paths);
  await mkdir(path.dirname(file), { recursive: true });
  index.updated_at = new Date().toISOString();
  await writeFile(file, JSON.stringify(index, null, 2), "utf8");
}

export function getUsage(index: UsageIndex, id: string): MemoryUsage {
  return normalizeUsage(index.by_id[id]);
}

export function bumpRead(index: UsageIndex, ids: string[]): UsageIndex {
  if (ids.length === 0) return index;
  const now = new Date().toISOString();
  for (const id of ids) {
    const current = normalizeUsage(index.by_id[id]);
    index.by_id[id] = {
      ...current,
      read_count: current.read_count + 1,
      last_read_at: now,
    };
  }
  return index;
}

export function recordRejection(
  index: UsageIndex,
  id: string,
  reason: string | null,
): UsageIndex {
  const current = normalizeUsage(index.by_id[id]);
  const now = new Date().toISOString();
  index.by_id[id] = {
    ...current,
    rejected_count: current.rejected_count + 1,
    last_rejected_at: now,
    rejection_reason: reason,
  };
  return index;
}

/**
 * Record that a memory was *applied* — explicitly confirmed to have changed what
 * the agent/human did. This is the closed-loop utility signal that distinguishes
 * a memory that merely got surfaced from one that demonstrably steered work.
 */
export function recordApplied(index: UsageIndex, id: string): UsageIndex {
  const current = normalizeUsage(index.by_id[id]);
  const now = new Date().toISOString();
  index.by_id[id] = {
    ...current,
    applied_count: current.applied_count + 1,
    last_applied_at: now,
  };
  return index;
}

/** Debounce window so re-scanning the same diff within a few minutes doesn't inflate prevention
 *  counts (a pre-commit hook can run the check several times for one commit). */
export const PREVENTION_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * Record a *prevention* event: a memory's sensor fired on a scanned diff, intercepting a known
 * mistake before it landed. Outcome signal (defect prevented), stronger than a read. Debounced by
 * {@link PREVENTION_DEBOUNCE_MS}. Returns true if a NEW event was recorded (false if debounced).
 */
export function recordPrevention(index: UsageIndex, id: string, now: number = Date.now()): boolean {
  const current = normalizeUsage(index.by_id[id]);
  const last = current.last_prevented_at ? Date.parse(current.last_prevented_at) : 0;
  if (Number.isFinite(last) && last > 0 && now - last < PREVENTION_DEBOUNCE_MS) {
    index.by_id[id] = current; // normalize in place, no count change
    return false;
  }
  index.by_id[id] = {
    ...current,
    prevented_count: current.prevented_count + 1,
    last_prevented_at: new Date(now).toISOString(),
  };
  return true;
}

export const DECAY_DAYS = 90;

export function isDecaying(usage: MemoryUsage, createdAt: string): boolean {
  const threshold = Date.now() - DECAY_DAYS * 24 * 60 * 60 * 1000;
  const anchor = usage.last_read_at ?? createdAt;
  return new Date(anchor).getTime() < threshold;
}

export async function trackReads(
  paths: HaivePaths,
  ids: string[],
): Promise<UsageIndex> {
  if (ids.length === 0) {
    return await loadUsageIndex(paths);
  }
  const index = await loadUsageIndex(paths);
  bumpRead(index, ids);
  await saveUsageIndex(paths, index);
  return index;
}
