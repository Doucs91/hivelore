/**
 * Project-context emission throttle — a token saver for long sessions.
 *
 * `get_briefing` re-emits the full `.ai/project-context.md` on every call. Across a 10-call session
 * that re-sends the same ~1.5k tokens nine times for nothing. This records a tiny marker (content
 * hash + timestamp, in gitignored `.ai/.runtime/context/`) so a briefing can skip re-emitting an UNCHANGED
 * context within a short window — the agent already has it from the earlier call.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { normalizeSessionId } from "./enforcement.js";
import { sessionIdentity } from "./task-session.js";
import type { HaivePaths } from "./paths.js";

/** How long an emitted project context is considered "still fresh in the agent's context". */
export const PROJECT_CONTEXT_THROTTLE_MS = 8 * 60 * 1000;

function throttleMarkerPath(paths: HaivePaths, sessionId?: string): string {
  return path.join(paths.runtimeDir, "context", `${normalizeSessionId(sessionIdentity(sessionId))}.json`);
}

/** Compaction invalidates delivered context, never the task's original Git baseline. */
export async function resetProjectContextEmission(paths: HaivePaths, sessionId?: string): Promise<void> {
  await rm(throttleMarkerPath(paths, sessionId), { force: true });
}

export function hashProjectContext(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

/** True if an identical project-context body was already emitted within the throttle window. */
export async function projectContextRecentlyEmitted(
  paths: HaivePaths,
  hash: string,
  now: number = Date.now(),
  sessionId?: string,
): Promise<boolean> {
  const file = throttleMarkerPath(paths, sessionId);
  if (!existsSync(file)) return false;
  try {
    const m = JSON.parse(await readFile(file, "utf8")) as { hash?: string; at?: string };
    if (m.hash !== hash || !m.at) return false;
    const age = now - Date.parse(m.at);
    return age >= 0 && age < PROJECT_CONTEXT_THROTTLE_MS;
  } catch {
    return false;
  }
}

/** Record that this exact project-context body was just emitted. Best-effort. */
export async function recordProjectContextEmission(
  paths: HaivePaths,
  hash: string,
  now: number = Date.now(),
  sessionId?: string,
): Promise<void> {
  const file = throttleMarkerPath(paths, sessionId);
  await mkdir(path.dirname(file), { recursive: true }).catch(() => { /* ignore */ });
  await writeFile(file, JSON.stringify({ hash, at: new Date(now).toISOString() }), "utf8").catch(() => { /* ignore */ });
}
