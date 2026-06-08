/**
 * Ephemeral session handoff — a single, overwritten `NEXT.md` at the repo root.
 *
 * An alternative to persisting an auto-generated `session_recap` memory into the indexed
 * `.ai/` corpus (which is low-signal, accumulates, and biases future briefings). The handoff
 * keeps ONLY what helps the next session/agent resume — open threads + next steps — in one
 * file that is overwritten every session and is meant to be gitignored (local, ephemeral).
 *
 * Pure builder (`buildHandoffMarkdown`) + thin I/O helpers. Unit-tested.
 */
import { writeFile, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/** Filename of the ephemeral handoff at the repo root. */
export const HANDOFF_FILENAME = "NEXT.md";

/** Absolute path to the handoff file for a given project root. */
export function handoffFilePath(root: string): string {
  return path.join(root, HANDOFF_FILENAME);
}

export interface SessionHandoffData {
  /** One-line focus of the session that just ended. */
  goal: string;
  /** Short work summary (e.g. tool/file rollup) — optional. */
  summary?: string;
  /** Unresolved items the next session should pick up (failures, attempts, TODOs). */
  openThreads?: string[];
  /** Files touched during the session. */
  filesTouched?: string[];
  /** What should happen next, free text. */
  nextSteps?: string;
  /** Optional `git diff --stat` style block to show what is uncommitted. */
  diffStat?: string;
  /** Timestamp; defaults to now. */
  at?: Date;
}

/**
 * Build the markdown body of the ephemeral handoff. Pure — no I/O.
 * Deliberately compact: focus + open threads + next steps are the load-bearing parts.
 */
export function buildHandoffMarkdown(data: SessionHandoffData): string {
  const at = (data.at ?? new Date()).toISOString();
  const lines: string[] = [];

  lines.push("# NEXT — session handoff");
  lines.push("");
  lines.push(
    "> Ephemeral, auto-overwritten each session. Not committed (gitignored). " +
      "It replaces the auto `session_recap` memory: open threads + next steps only, " +
      "not a tool-call dump.",
  );
  lines.push(`> Updated: ${at}`);
  lines.push("");

  lines.push("## Focus");
  lines.push(data.goal.trim() || "_(no goal captured)_");
  lines.push("");

  lines.push("## Open threads");
  const threads = (data.openThreads ?? []).map((t) => t.trim()).filter(Boolean);
  if (threads.length > 0) {
    for (const t of threads) lines.push(`- ${t}`);
  } else {
    lines.push("_None captured._");
  }
  lines.push("");

  lines.push("## Next steps");
  lines.push(data.nextSteps?.trim() || "_None captured — derive from open threads / git status._");
  lines.push("");

  const files = (data.filesTouched ?? []).map((f) => f.trim()).filter(Boolean);
  if (files.length > 0) {
    lines.push("## Files touched");
    for (const f of files.slice(0, 20)) lines.push(`- \`${f}\``);
    if (files.length > 20) lines.push(`- …and ${files.length - 20} more`);
    lines.push("");
  }

  if (data.summary?.trim()) {
    lines.push("## Work summary");
    lines.push(data.summary.trim());
    lines.push("");
  }

  if (data.diffStat?.trim()) {
    lines.push("## Uncommitted (git diff --stat)");
    lines.push("```");
    lines.push(data.diffStat.trim());
    lines.push("```");
    lines.push("");
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/** Write (overwrite) the ephemeral handoff. Returns the file path. Best-effort caller should catch. */
export async function writeSessionHandoff(root: string, data: SessionHandoffData): Promise<string> {
  const file = handoffFilePath(root);
  await writeFile(file, buildHandoffMarkdown(data), "utf8");
  return file;
}

/** Read the handoff body if present, else null. */
export async function readSessionHandoff(root: string): Promise<string | null> {
  const file = handoffFilePath(root);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf8").catch(() => "");
  return raw.trim() ? raw : null;
}

/** Age of the handoff file in milliseconds (by mtime), or null if it does not exist. */
export async function handoffAgeMs(root: string, now: Date = new Date()): Promise<number | null> {
  const file = handoffFilePath(root);
  if (!existsSync(file)) return null;
  try {
    const s = await stat(file);
    // An age is a duration — clamp to 0. The filesystem mtime can read a hair AHEAD of `now`
    // (sub-millisecond clock skew / timestamp rounding), which otherwise yields a spurious
    // negative age and a flaky `age >= 0` assertion right after writing the file.
    return Math.max(0, now.getTime() - s.mtimeMs);
  } catch {
    return null;
  }
}
