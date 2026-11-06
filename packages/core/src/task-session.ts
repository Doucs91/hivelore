import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { normalizeSessionId } from "./enforcement.js";
import type { HaivePaths } from "./paths.js";

const exec = promisify(execFile);
export type CompletionMode = "read" | "local" | "commit" | "release";
export interface TaskSession {
  version: 1;
  root: string;
  branch: string;
  head: string;
  started_at: string;
  mode?: CompletionMode;
  task?: string;
  next_steps?: string;
  accomplished?: string;
  baseline: Record<string, string>;
  observed: Record<string, string>;
}

/**
 * Environment variables that name the CURRENT agent session, in precedence order.
 *
 * Claude Code exports `CLAUDE_CODE_SESSION_ID` to every Bash tool call and passes the same UUID as
 * `session_id` in hook payloads. Hivelore used to read only `CLAUDE_SESSION_ID`, which Claude Code
 * never sets — so the SessionStart hook recorded the task baseline under the real UUID while every
 * CLI call the agent made (`enforce finish`, `briefing`, `check --session`) looked under "default".
 * The visible effect was a `finish` that sometimes told the agent to commit and push the
 * developer's pre-existing work (field reports #10 §3, #11 §1) and a `requireBriefingFirst` flag
 * that could not see the agent's own briefing (#11 §6).
 */
export const SESSION_ENV_VARS = [
  "HIVELORE_SESSION_ID",
  "HAIVE_SESSION_ID",
  "CLAUDE_SESSION_ID",
  "CLAUDE_CODE_SESSION_ID",
] as const;

/** The agent session named by the environment, if any (never "default"). */
export function sessionIdFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of SESSION_ENV_VARS) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

export function sessionIdentity(explicit?: string): string {
  return explicit?.trim() || sessionIdFromEnv() || "default";
}

export async function gitText(root: string, args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })).stdout;
}

/** Git's NUL format preserves spaces, quotes and rename source/destination boundaries. */
export function dirtyStatusEntries(raw: string): Array<{ file: string; status: string }> {
  const parts = raw.split("\0");
  const out: Array<{ file: string; status: string }> = [];
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i]!;
    if (line.length < 4) continue;
    const status = line.slice(0, 2);
    out.push({ file: line.slice(3), status });
    if (/[RC]/.test(status)) i++; // -z emits destination, then source
  }
  return out;
}

export async function worktreeSnapshot(root: string): Promise<Record<string, string>> {
  const raw = await gitText(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  const index = await gitText(root, ["ls-files", "-s", "-z"]);
  const staged = new Map(index.split("\0").map((entry) => {
    const tab = entry.indexOf("\t");
    return [entry.slice(tab + 1), entry.slice(0, tab)];
  }));
  const out: Record<string, string> = Object.create(null);
  for (const { file, status } of dirtyStatusEntries(raw)) {
    const abs = path.resolve(root, file);
    if (!abs.startsWith(path.resolve(root) + path.sep)) continue;
    let fingerprint = "deleted";
    try {
      const st = await lstat(abs);
      if (st.isFile()) {
        fingerprint = st.size < 8 * 1024 * 1024
          ? createHash("sha256").update(await readFile(abs)).digest("hex")
          : `large:${st.size}:${st.mtimeMs}`;
      } else fingerprint = `other:${st.size}:${st.mtimeMs}`;
    } catch { /* deletion */ }
    out[file] = `${status}:${staged.get(file) ?? ""}:${fingerprint}`;
  }
  return out;
}

function statePath(paths: HaivePaths, id?: string): string {
  return path.join(paths.runtimeDir, "tasks", `${normalizeSessionId(sessionIdentity(id))}.json`);
}

/** Default freshness for a task baseline used to ATTRIBUTE work (read tasks, observed edits). */
export const TASK_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/**
 * Freshness for a baseline used only to EXCLUDE pre-existing work at `finish`. Excluding a file that
 * is byte-identical to its state when the task started is safe at any age — a later edit changes its
 * hash and makes it owned again — so long conversations (field report #11 ran 8 days) keep their
 * baseline instead of silently claiming the developer's work in progress.
 */
export const TASK_BASELINE_EXCLUSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export async function loadTaskSession(
  paths: HaivePaths,
  id?: string,
  options: { maxAgeMs?: number } = {},
): Promise<TaskSession | null> {
  return readTaskSessionFile(paths, statePath(paths, id), options.maxAgeMs ?? TASK_SESSION_MAX_AGE_MS);
}

/**
 * The most recent task baseline recorded by ANY session for this root, within `maxAgeMs`.
 *
 * Used by `finish` only when the caller's own session has no baseline (a client that does not
 * export its session id, a CLI call outside the hook's session). It lets the gate still recognise
 * the developer's pre-existing work instead of attributing every dirty file to the task.
 */
export async function latestTaskSession(
  paths: HaivePaths,
  maxAgeMs = TASK_BASELINE_EXCLUSION_MAX_AGE_MS,
): Promise<{ id: string; session: TaskSession } | null> {
  const dir = path.join(paths.runtimeDir, "tasks");
  let names: string[] = [];
  try { names = (await readdir(dir)).filter((name) => name.endsWith(".json")); } catch { return null; }
  let best: { id: string; session: TaskSession } | null = null;
  for (const name of names) {
    const session = await readTaskSessionFile(paths, path.join(dir, name), maxAgeMs);
    if (!session) continue;
    if (!best || Date.parse(session.started_at) > Date.parse(best.session.started_at)) {
      best = { id: name.slice(0, -".json".length), session };
    }
  }
  return best;
}

async function readTaskSessionFile(paths: HaivePaths, file: string, maxAgeMs: number): Promise<TaskSession | null> {
  try {
    const state = JSON.parse(await readFile(file, "utf8")) as TaskSession;
    if (state.version !== 1 || state.root !== paths.root || !state.baseline || !state.observed) return null;
    // A default id must never attribute yesterday's changes to today's task.
    const age = Date.now() - Date.parse(state.started_at);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
    if (state.mode && !["read", "local", "commit", "release"].includes(state.mode)) return null;
    for (const snapshot of [state.baseline, state.observed]) {
      if (typeof snapshot !== "object" || Array.isArray(snapshot) || Object.values(snapshot).some(v => typeof v !== "string")) return null;
    }
    return state;
  } catch { return null; }
}

export async function saveTaskSession(paths: HaivePaths, state: TaskSession, id?: string): Promise<void> {
  const file = statePath(paths, id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state) + "\n");
}

/** Called only at an explicit task/session start, before any edit. */
export async function startTaskSession(paths: HaivePaths, id?: string, mode?: CompletionMode, task?: string): Promise<TaskSession> {
  const baseline = await worktreeSnapshot(paths.root);
  const branch = (await gitText(paths.root, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "")).trim();
  const head = (await gitText(paths.root, ["rev-parse", "HEAD"]).catch(() => "")).trim();
  const state: TaskSession = { version: 1, root: paths.root, branch, head,
    started_at: new Date().toISOString(), baseline, observed: baseline, ...(mode ? { mode } : {}), ...(task ? { task } : {}) };
  await saveTaskSession(paths, state, id);
  return state;
}

export function changedSince(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => before[file] !== after[file]);
}

/**
 * The content part of a snapshot fingerprint (`<status>:<index entry>:<content>`).
 *
 * Status and index columns are relative to HEAD, so a branch switch or a pull that moves HEAD
 * changes them for a file nobody touched. Ownership must follow the bytes on disk only.
 */
export function snapshotContent(fingerprint: string | undefined): string | undefined {
  if (fingerprint === undefined) return undefined;
  const parts = fingerprint.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : fingerprint;
}

/**
 * Files this task owns: everything dirty now that was not dirty, byte-identical, at the baseline.
 * A file dirty at session start and byte-identical at finish is pre-existing work, whatever HEAD
 * did in between (field report #11 §1). A later edit to the same file changes its hash: owned.
 */
export function taskDirtyFiles(state: TaskSession, current: Record<string, string>): string[] {
  return Object.keys(current).filter((file) => {
    const before = snapshotContent(state.baseline[file]);
    return before === undefined || snapshotContent(current[file]) !== before;
  });
}
