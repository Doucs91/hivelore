import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export const USAGE_LOG_FILE = "tool-usage.jsonl";
export const USAGE_LOG_DIR = ".usage";

export interface UsageEvent {
  /** ISO timestamp */
  at: string;
  /** Tool name (MCP tool or CLI command) */
  tool: string;
  /** Truncated, non-sensitive snapshot of the input */
  summary?: string;
}

export function usageLogPath(paths: HaivePaths): string {
  return path.join(paths.haiveDir, USAGE_LOG_DIR, USAGE_LOG_FILE);
}

/**
 * Append a single usage event to the rolling log. Best-effort: failures are
 * swallowed since logging must never block tool execution.
 */
export async function appendUsageEvent(paths: HaivePaths, event: UsageEvent): Promise<void> {
  try {
    const file = usageLogPath(paths);
    const dir = path.dirname(file);
    if (!existsSync(dir)) await mkdir(dir, { recursive: true });
    await appendFile(file, JSON.stringify(event) + "\n", "utf8");
  } catch {
    // Logging is best-effort.
  }
}

/**
 * Read all usage events from disk. Skips malformed lines silently.
 * For very large logs (>50k lines), prefer `streamUsageEvents` (not implemented yet).
 */
export async function readUsageEvents(paths: HaivePaths): Promise<UsageEvent[]> {
  const file = usageLogPath(paths);
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  const out: UsageEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as UsageEvent;
      if (parsed.tool && parsed.at) out.push(parsed);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

export interface UsageAggregate {
  total: number;
  by_tool: Array<{ tool: string; count: number; last_used: string }>;
  /** Most-frequently called tools first */
  top: Array<{ tool: string; count: number }>;
  window_start: string | null;
  window_end: string | null;
}

/**
 * Bucket events by tool, optionally filtered by a since cutoff (ISO date or relative like '7d').
 */
export function aggregateUsage(events: UsageEvent[], since?: Date): UsageAggregate {
  const cutoff = since ? since.getTime() : 0;
  const filtered = cutoff > 0
    ? events.filter((e) => Date.parse(e.at) >= cutoff)
    : events;

  const counts = new Map<string, { count: number; last: string }>();
  for (const e of filtered) {
    const prior = counts.get(e.tool);
    if (!prior) counts.set(e.tool, { count: 1, last: e.at });
    else {
      prior.count++;
      if (e.at > prior.last) prior.last = e.at;
    }
  }

  const by_tool = [...counts.entries()]
    .map(([tool, { count, last }]) => ({ tool, count, last_used: last }))
    .sort((a, b) => b.count - a.count);

  const sorted = filtered.slice().sort((a, b) => a.at.localeCompare(b.at));

  return {
    total: filtered.length,
    by_tool,
    top: by_tool.slice(0, 10).map(({ tool, count }) => ({ tool, count })),
    window_start: sorted[0]?.at ?? null,
    window_end: sorted[sorted.length - 1]?.at ?? null,
  };
}

/**
 * Parse a since string: ISO date, or relative like '7d', '24h', '30m'.
 * Returns null when input is empty/undefined.
 */
export function parseSince(input: string | undefined): Date | null {
  if (!input) return null;
  const m = input.match(/^(\d+)([dhm])$/);
  if (m) {
    const n = parseInt(m[1] ?? "0", 10);
    const unit = m[2] ?? "d";
    const ms = unit === "d" ? n * 86400_000 : unit === "h" ? n * 3600_000 : n * 60_000;
    return new Date(Date.now() - ms);
  }
  const parsed = new Date(input);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export async function usageLogSize(paths: HaivePaths): Promise<{ exists: boolean; size_bytes: number; lines: number }> {
  const file = usageLogPath(paths);
  if (!existsSync(file)) return { exists: false, size_bytes: 0, lines: 0 };
  const st = await stat(file);
  const raw = await readFile(file, "utf8");
  return { exists: true, size_bytes: st.size, lines: raw.split("\n").filter((l) => l).length };
}
