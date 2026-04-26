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
  };
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
  return index.by_id[id] ?? emptyUsage();
}

export function bumpRead(index: UsageIndex, ids: string[]): UsageIndex {
  if (ids.length === 0) return index;
  const now = new Date().toISOString();
  for (const id of ids) {
    const current = index.by_id[id] ?? emptyUsage();
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
  const current = index.by_id[id] ?? emptyUsage();
  const now = new Date().toISOString();
  index.by_id[id] = {
    ...current,
    rejected_count: current.rejected_count + 1,
    last_rejected_at: now,
    rejection_reason: reason,
  };
  return index;
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
