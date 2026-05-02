import { Command } from "commander";
import {
  aggregateUsage,
  findProjectRoot,
  parseSince,
  readUsageEvents,
  resolveHaivePaths,
  usageLogSize,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface StatsOptions {
  since?: string;
  json?: boolean;
  dir?: string;
}

export function registerStats(program: Command): void {
  program
    .command("stats")
    .description("Show MCP tool-usage stats over a window (e.g. --since 7d).")
    .option("--since <window>", "ISO date or relative (e.g. '7d', '24h', '30m')", "30d")
    .option("--json", "emit JSON instead of human-readable output", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: StatsOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);

      const size = await usageLogSize(paths);
      if (!size.exists) {
        if (opts.json) {
          console.log(JSON.stringify({ error: "no_usage_log" }));
          return;
        }
        ui.warn(
          `No usage log found at ${root}. ` +
          `Stats are populated as the MCP server logs each tool call. ` +
          `Run a session first, then re-check.`,
        );
        return;
      }

      const events = await readUsageEvents(paths);
      const since = parseSince(opts.since);
      const aggregate = aggregateUsage(events, since ?? undefined);

      if (opts.json) {
        console.log(JSON.stringify(aggregate, null, 2));
        return;
      }

      const window = opts.since ?? "all time";
      console.log(ui.bold(`hAIve usage stats (${window})`));
      console.log(
        `  ${ui.dim("total calls:")} ${aggregate.total}  ` +
        `${ui.dim("unique tools:")} ${aggregate.by_tool.length}  ` +
        `${ui.dim("log lines:")} ${size.lines}`,
      );
      if (aggregate.window_start) {
        console.log(
          `  ${ui.dim("window:")} ${aggregate.window_start.slice(0, 19)} → ${aggregate.window_end?.slice(0, 19)}`,
        );
      }
      if (aggregate.by_tool.length === 0) {
        ui.info(`No events in window. Try a wider --since (current: ${window}).`);
        return;
      }
      console.log();
      console.log(ui.bold("Top tools:"));
      const maxCount = aggregate.by_tool[0]?.count ?? 1;
      for (const t of aggregate.by_tool.slice(0, 20)) {
        const bar = "█".repeat(Math.max(1, Math.round((t.count / maxCount) * 30)));
        const pct = ((t.count / aggregate.total) * 100).toFixed(1);
        console.log(
          `  ${t.tool.padEnd(28)} ${ui.green(bar)} ${ui.bold(String(t.count))} ` +
          `${ui.dim(`(${pct}%, last ${t.last_used.slice(0, 19)})`)}`,
        );
      }
    });
}
