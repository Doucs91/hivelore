import { mkdir, readFile, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export const RUNTIME_JOURNAL_FILENAME = "session-journal.ndjson";

export interface RuntimeJournalEntry {
  ts: string;
  kind: "note" | "session_end" | "mcp";
  /** Short human or agent message */
  message: string;
  /** Optional MCP tool name for kind=mcp */
  tool?: string;
  /** Arbitrary JSON-serializable metadata */
  meta?: Record<string, unknown>;
}

export function runtimeJournalPath(paths: HaivePaths): string {
  return path.join(paths.runtimeDir, RUNTIME_JOURNAL_FILENAME);
}

/**
 * Append one NDJSON line under `.ai/.runtime/` (untracked by default).
 * Never throws to callers of shutdown hooks — wraps internally.
 */
export async function appendRuntimeJournalEntry(
  paths: HaivePaths,
  entry: Omit<RuntimeJournalEntry, "ts"> & { ts?: string },
): Promise<void> {
  try {
    await mkdir(paths.runtimeDir, { recursive: true });
    const line: RuntimeJournalEntry = {
      ts: entry.ts ?? new Date().toISOString(),
      kind: entry.kind,
      message: entry.message,
      ...(entry.tool !== undefined ? { tool: entry.tool } : {}),
      ...(entry.meta !== undefined ? { meta: entry.meta } : {}),
    };
    await appendFile(
      runtimeJournalPath(paths),
      JSON.stringify(line) + "\n",
      "utf8",
    );
  } catch {
    // non-fatal — runtime layer must not break tools
  }
}

/** Read last N valid JSON lines (oldest-first in returned array). */
export async function readRuntimeJournalTail(
  paths: HaivePaths,
  limit: number,
): Promise<RuntimeJournalEntry[]> {
  const file = runtimeJournalPath(paths);
  if (!existsSync(file) || limit <= 0) return [];
  try {
    const raw = await readFile(file, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    const parsed: RuntimeJournalEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try {
        parsed.push(JSON.parse(line) as RuntimeJournalEntry);
      } catch {
        /* skip corrupt line */
      }
    }
    return parsed;
  } catch {
    return [];
  }
}
