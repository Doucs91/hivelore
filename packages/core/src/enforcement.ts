import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export const BRIEFING_MARKER_TTL_MS = 12 * 60 * 60 * 1000;
export const SESSION_RECAP_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface BriefingMarker {
  session_id: string;
  task?: string;
  source: string;
  created_at: string;
  root: string;
  memory_ids?: string[];
  files?: string[];
}

export function enforcementDir(paths: HaivePaths): string {
  return path.join(paths.runtimeDir, "enforcement");
}

export function briefingMarkersDir(paths: HaivePaths): string {
  return path.join(enforcementDir(paths), "briefings");
}

export function normalizeSessionId(sessionId?: string): string {
  return (sessionId?.trim() || "default").replace(/[^a-zA-Z0-9_.-]+/g, "-").slice(0, 120);
}

export function briefingMarkerPath(paths: HaivePaths, sessionId?: string): string {
  return path.join(briefingMarkersDir(paths), `${normalizeSessionId(sessionId)}.json`);
}

export async function writeBriefingMarker(
  paths: HaivePaths,
  input: { sessionId?: string; task?: string; source: string; memoryIds?: string[]; files?: string[] },
): Promise<BriefingMarker> {
  const marker: BriefingMarker = {
    session_id: normalizeSessionId(input.sessionId),
    ...(input.task?.trim() ? { task: input.task.trim() } : {}),
    ...(input.memoryIds && input.memoryIds.length > 0 ? { memory_ids: [...new Set(input.memoryIds)] } : {}),
    ...(input.files && input.files.length > 0 ? { files: [...new Set(input.files)] } : {}),
    source: input.source,
    created_at: new Date().toISOString(),
    root: paths.root,
  };
  await mkdir(briefingMarkersDir(paths), { recursive: true });
  await writeFile(
    briefingMarkerPath(paths, marker.session_id),
    JSON.stringify(marker, null, 2) + "\n",
    "utf8",
  );
  return marker;
}

export async function hasRecentBriefingMarker(
  paths: HaivePaths,
  sessionId?: string,
  ttlMs = BRIEFING_MARKER_TTL_MS,
): Promise<boolean> {
  const now = Date.now();
  const candidates: string[] = [];
  const exact = briefingMarkerPath(paths, sessionId);
  if (existsSync(exact)) candidates.push(exact);
  try {
    const dir = briefingMarkersDir(paths);
    const files = await readdir(dir);
    for (const file of files) {
      if (file.endsWith(".json")) candidates.push(path.join(dir, file));
    }
  } catch {
    // no marker directory yet
  }

  for (const file of new Set(candidates)) {
    try {
      const marker = JSON.parse(await readFile(file, "utf8")) as BriefingMarker;
      const created = Date.parse(marker.created_at);
      if (Number.isFinite(created) && now - created <= ttlMs) return true;
    } catch {
      // ignore corrupt markers
    }
  }
  return false;
}

export async function readRecentBriefingMarker(
  paths: HaivePaths,
  sessionId?: string,
  ttlMs = BRIEFING_MARKER_TTL_MS,
): Promise<BriefingMarker | null> {
  const now = Date.now();
  const candidates: string[] = [];
  const exact = briefingMarkerPath(paths, sessionId);
  if (existsSync(exact)) candidates.push(exact);
  try {
    const dir = briefingMarkersDir(paths);
    const files = await readdir(dir);
    for (const file of files) {
      if (file.endsWith(".json")) candidates.push(path.join(dir, file));
    }
  } catch {
    // no marker directory yet
  }

  let freshest: BriefingMarker | null = null;
  let freshestTs = 0;
  for (const file of new Set(candidates)) {
    try {
      const marker = JSON.parse(await readFile(file, "utf8")) as BriefingMarker;
      const created = Date.parse(marker.created_at);
      if (!Number.isFinite(created) || now - created > ttlMs) continue;
      if (created > freshestTs) {
        freshest = marker;
        freshestTs = created;
      }
    } catch {
      // ignore corrupt markers
    }
  }
  return freshest;
}

export function isFreshIsoDate(value: string | Date, ttlMs: number, now = Date.now()): boolean {
  const ts = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ts) && now - ts <= ttlMs;
}
