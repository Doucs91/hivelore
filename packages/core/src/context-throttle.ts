/**
 * Project-context emission throttle — a token saver for long sessions.
 *
 * `get_briefing` re-emits the full `.ai/project-context.md` on every call. Across a 10-call session
 * that re-sends the same ~1.5k tokens nine times for nothing. This records a tiny marker (content
 * hash + timestamp, in gitignored `.ai/.cache/`) so a briefing can skip re-emitting an UNCHANGED
 * context within a short window — the agent already has it from the earlier call.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

/** How long an emitted project context is considered "still fresh in the agent's context". */
export const PROJECT_CONTEXT_THROTTLE_MS = 8 * 60 * 1000;

function throttleMarkerPath(paths: HaivePaths): string {
  return path.join(paths.haiveDir, ".cache", "briefing-context.json");
}

export function hashProjectContext(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

/** True if an identical project-context body was already emitted within the throttle window. */
export async function projectContextRecentlyEmitted(
  paths: HaivePaths,
  hash: string,
  now: number = Date.now(),
): Promise<boolean> {
  const file = throttleMarkerPath(paths);
  if (!existsSync(file)) return false;
  try {
    const m = JSON.parse(await readFile(file, "utf8")) as { hash?: string; at?: string };
    if (m.hash !== hash || !m.at) return false;
    return now - Date.parse(m.at) < PROJECT_CONTEXT_THROTTLE_MS;
  } catch {
    return false;
  }
}

/** Record that this exact project-context body was just emitted. Best-effort. */
export async function recordProjectContextEmission(
  paths: HaivePaths,
  hash: string,
  now: number = Date.now(),
): Promise<void> {
  const file = throttleMarkerPath(paths);
  await mkdir(path.dirname(file), { recursive: true }).catch(() => { /* ignore */ });
  await writeFile(file, JSON.stringify({ hash, at: new Date(now).toISOString() }), "utf8").catch(() => { /* ignore */ });
}
