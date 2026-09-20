import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
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
  baseline: Record<string, string>;
  observed: Record<string, string>;
}

export function sessionIdentity(explicit?: string): string {
  return explicit ?? process.env.HIVELORE_SESSION_ID ?? process.env.HAIVE_SESSION_ID ??
    process.env.CLAUDE_SESSION_ID ?? "default";
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

export async function loadTaskSession(paths: HaivePaths, id?: string): Promise<TaskSession | null> {
  try {
    const state = JSON.parse(await readFile(statePath(paths, id), "utf8")) as TaskSession;
    if (state.version !== 1 || state.root !== paths.root || !state.baseline || !state.observed) return null;
    // A default id must never attribute yesterday's changes to today's task.
    const age = Date.now() - Date.parse(state.started_at);
    if (!Number.isFinite(age) || age < 0 || age > 12 * 60 * 60 * 1000) return null;
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
export async function startTaskSession(paths: HaivePaths, id?: string, mode?: CompletionMode): Promise<TaskSession> {
  const baseline = await worktreeSnapshot(paths.root);
  const branch = (await gitText(paths.root, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "")).trim();
  const head = (await gitText(paths.root, ["rev-parse", "HEAD"]).catch(() => "")).trim();
  const state: TaskSession = { version: 1, root: paths.root, branch, head,
    started_at: new Date().toISOString(), baseline, observed: baseline, ...(mode ? { mode } : {}) };
  await saveTaskSession(paths, state, id);
  return state;
}

export function changedSince(before: Record<string, string>, after: Record<string, string>): string[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => before[file] !== after[file]);
}

/** Exclude only byte/index-identical pre-existing work. A later edit to the same file is owned. */
export function taskDirtyFiles(state: TaskSession, current: Record<string, string>): string[] {
  return Object.keys(current).filter((file) => current[file] !== state.baseline[file]);
}
