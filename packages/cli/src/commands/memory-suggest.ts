import { Command } from "commander";
import {
  aggregateUsage,
  findProjectRoot,
  parseSince,
  readUsageEvents,
  resolveHaivePaths,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface SuggestOptions {
  since?: string;
  min?: string;
  json?: boolean;
  dir?: string;
}

const SEARCH_TOOLS = new Set([
  "mem_search",
  "code_search",
  "mem_relevant_to",
  "get_briefing",
]);

interface QuerySuggestion {
  query: string;
  count: number;
  tools: string[];
  last_used: string;
  reason: string;
}

export function registerMemorySuggest(memory: Command): void {
  memory
    .command("suggest")
    .description("Suggest memories to create based on recurring search queries in the usage log.")
    .option("--since <window>", "ISO date or relative (e.g. '7d', '24h')", "30d")
    .option("--min <count>", "minimum repeat count to surface a query", "2")
    .option("--json", "emit JSON instead of human-readable output", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SuggestOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const events = await readUsageEvents(paths);
      if (events.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ suggestions: [] }));
          return;
        }
        ui.warn("No usage log entries yet. Suggestions appear after the MCP server records some calls.");
        return;
      }

      const since = parseSince(opts.since);
      const minCount = Math.max(1, parseInt(opts.min ?? "2", 10));
      const cutoff = since ? since.getTime() : 0;

      const queries = new Map<string, { count: number; tools: Set<string>; last: string }>();
      for (const e of events) {
        if (cutoff && Date.parse(e.at) < cutoff) continue;
        if (!SEARCH_TOOLS.has(e.tool)) continue;
        const key = (e.summary ?? "").toLowerCase().trim();
        if (!key) continue;
        const prior = queries.get(key);
        if (prior) {
          prior.count++;
          prior.tools.add(e.tool);
          if (e.at > prior.last) prior.last = e.at;
        } else {
          queries.set(key, { count: 1, tools: new Set([e.tool]), last: e.at });
        }
      }

      const suggestions: QuerySuggestion[] = [...queries.entries()]
        .filter(([, v]) => v.count >= minCount)
        .map(([query, v]) => ({
          query,
          count: v.count,
          tools: [...v.tools].sort(),
          last_used: v.last,
          reason: chooseReason(v.tools, v.count),
        }))
        .sort((a, b) => b.count - a.count);

      if (opts.json) {
        console.log(JSON.stringify({ window: opts.since, suggestions }, null, 2));
        return;
      }

      const totals = aggregateUsage(events, since ?? undefined);
      console.log(ui.bold(`hAIve memory suggestions (${opts.since ?? "all time"})`));
      console.log(
        ui.dim(`scanned ${totals.total} events, ${suggestions.length} repeated queries (≥${minCount})`),
      );
      console.log();
      if (suggestions.length === 0) {
        ui.info("No recurring searches yet — nothing to suggest.");
        return;
      }
      for (const s of suggestions.slice(0, 30)) {
        console.log(
          `  ${ui.bold(`×${s.count}`)} ${ui.dim(`[${s.tools.join(",")}]`)}  ${truncate(s.query, 70)}`,
        );
        console.log(`     ${ui.dim("→")} ${s.reason}`);
      }
    });
}

function chooseReason(tools: Set<string>, count: number): string {
  if (tools.has("code_search")) {
    return `${count} agents searched the code for this — consider mem_save (architecture/decision) capturing where it lives.`;
  }
  if (tools.has("mem_search") || tools.has("mem_relevant_to")) {
    return `${count} agents asked but the memory layer had no clear answer — consider mem_save (convention/decision/gotcha).`;
  }
  return `${count} agents asked the briefing for this — consider promoting the answer to a team memory.`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
