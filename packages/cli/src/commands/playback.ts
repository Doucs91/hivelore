import { existsSync } from "node:fs";
import { Command } from "commander";
import {
  findProjectRoot,
  loadMemoriesFromDir,
  parseSince,
  readUsageEvents,
  resolveHaivePaths,
  type UsageEvent,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface PlaybackOptions {
  since?: string;
  json?: boolean;
  dir?: string;
  sessionGap?: string;
  limit?: string;
}

interface SessionBucket {
  index: number;
  start: string;
  end: string;
  duration_minutes: number;
  events: number;
  tools_count: Record<string, number>;
  briefing_tasks: string[];
  memories_created_since: number;
  /** memories that exist now but didn't at session start */
  new_memories: string[];
}

const MS_PER_MINUTE = 60_000;

export function registerPlayback(program: Command): void {
  program
    .command("playback")
    .description(
      "Replay past sessions from the usage log. For each session, show:\n" +
      "  - tool calls (what kind, how many)\n" +
      "  - briefing tasks asked\n" +
      "  - memories that have been created since then (that the session didn't have)\n\n" +
      "  Useful to ask 'would today's haive have helped past me on this task?'",
    )
    .option("--since <window>", "limit to events in this window (e.g. '7d')", "30d")
    .option("--session-gap <minutes>", "minutes of inactivity that splits a session", "30")
    .option("--limit <n>", "show at most this many sessions (newest first)", "10")
    .option("--json", "emit JSON instead of human-readable output", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: PlaybackOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);

      const events = await readUsageEvents(paths);
      if (events.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ sessions: [] }));
          return;
        }
        ui.warn("No usage log entries yet.");
        return;
      }

      const since = parseSince(opts.since);
      const cutoff = since ? since.getTime() : 0;
      const filtered = cutoff > 0
        ? events.filter((e) => Date.parse(e.at) >= cutoff)
        : events;

      const gapMs = Math.max(1, parseInt(opts.sessionGap ?? "30", 10)) * MS_PER_MINUTE;
      const sessions = bucketSessions(filtered, gapMs);

      // Load memories and pre-index by created_at to compute "new memories since" deltas.
      const all = existsSync(paths.memoriesDir) ? await loadMemoriesFromDir(paths.memoriesDir) : [];
      const memByCreatedAt = all
        .filter(({ memory }) => memory.frontmatter.type !== "session_recap")
        .map(({ memory }) => ({ id: memory.frontmatter.id, at: Date.parse(memory.frontmatter.created_at) }))
        .sort((a, b) => a.at - b.at);

      const enriched: SessionBucket[] = sessions.map((s, i) => {
        const startMs = Date.parse(s.start);
        const newer = memByCreatedAt.filter((m) => m.at > startMs);
        return {
          index: i,
          start: s.start,
          end: s.end,
          duration_minutes: (Date.parse(s.end) - startMs) / MS_PER_MINUTE,
          events: s.events.length,
          tools_count: countTools(s.events),
          briefing_tasks: s.events
            .filter((e) => e.tool === "get_briefing" && e.summary)
            .map((e) => e.summary!)
            .slice(0, 5),
          memories_created_since: newer.length,
          new_memories: newer.slice(0, 5).map((m) => m.id),
        };
      });

      // Sort newest first and apply limit
      enriched.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
      const limit = Math.max(1, parseInt(opts.limit ?? "10", 10));
      const shown = enriched.slice(0, limit);

      if (opts.json) {
        console.log(JSON.stringify({
          window: opts.since,
          session_gap_minutes: gapMs / MS_PER_MINUTE,
          total_sessions: enriched.length,
          sessions: shown,
        }, null, 2));
        return;
      }

      console.log(ui.bold(`hAIve playback — ${enriched.length} session(s) over ${opts.since ?? "all time"}`));
      console.log();
      for (const s of shown) {
        console.log(
          `${ui.bold(`Session ${s.index + 1}`)}  ${ui.dim(s.start.slice(0, 19) + " → " + s.end.slice(11, 19))}` +
          `  ${ui.dim(`(${Math.round(s.duration_minutes)}m, ${s.events} call${s.events === 1 ? "" : "s"})`)}`,
        );
        const toolList = Object.entries(s.tools_count)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([t, n]) => `${t}×${n}`)
          .join(", ");
        if (toolList) console.log(`  ${ui.dim("tools:")} ${toolList}`);
        if (s.briefing_tasks.length > 0) {
          console.log(`  ${ui.dim("briefings asked:")}`);
          for (const t of s.briefing_tasks) {
            console.log(`    • ${truncate(t, 80)}`);
          }
        }
        if (s.memories_created_since > 0) {
          console.log(
            `  ${ui.green("⤴")} ${s.memories_created_since} memor${s.memories_created_since === 1 ? "y has" : "ies have"} been created since this session ` +
            ui.dim(`— newer haive could have answered better`),
          );
          for (const id of s.new_memories) {
            console.log(`    + ${ui.dim(id)}`);
          }
        }
        console.log();
      }
    });
}

function bucketSessions(events: UsageEvent[], gapMs: number): Array<{ start: string; end: string; events: UsageEvent[] }> {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const buckets: Array<{ start: string; end: string; events: UsageEvent[] }> = [];
  let current: { start: string; end: string; events: UsageEvent[] } | null = null;
  for (const e of sorted) {
    if (!current) {
      current = { start: e.at, end: e.at, events: [e] };
      continue;
    }
    if (Date.parse(e.at) - Date.parse(current.end) > gapMs) {
      buckets.push(current);
      current = { start: e.at, end: e.at, events: [e] };
    } else {
      current.events.push(e);
      current.end = e.at;
    }
  }
  if (current) buckets.push(current);
  return buckets;
}

function countTools(events: UsageEvent[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of events) out[e.tool] = (out[e.tool] ?? 0) + 1;
  return out;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
