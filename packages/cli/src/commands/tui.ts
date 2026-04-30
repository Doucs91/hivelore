import { Command } from "commander";
import { findProjectRoot } from "@hiveai/core";

export function registerTui(program: Command): void {
  program
    .command("tui")
    .description(
      "Interactive terminal dashboard for browsing and managing memories.\n\n" +
      "  Screens (switch with 1 / 2 / 3):\n" +
      "    1 — Memories: list + preview, filter by status (Tab), actions (a/r/p/d)\n" +
      "    2 — Health:   stale, pending review, anchorless memories\n" +
      "    3 — Stats:    most-read, decaying, total counts\n\n" +
      "  Key bindings:\n" +
      "    ↑ ↓     navigate list\n" +
      "    Tab     cycle status filter (all → proposed → validated → stale)\n" +
      "    a       approve selected memory\n" +
      "    r       reject selected memory\n" +
      "    p       promote personal → team (proposed)\n" +
      "    d       delete selected memory\n" +
      "    q / Esc exit\n",
    )
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: { dir?: string }) => {
      if (!process.stdout.isTTY) {
        console.error("haive tui requires an interactive terminal (TTY).");
        process.exitCode = 1;
        return;
      }
      const root = findProjectRoot(opts.dir);
      const { render } = await import("ink");
      const { createElement } = await import("react");
      const { Dashboard } = await import("../tui/Dashboard.js");
      const { waitUntilExit } = render(createElement(Dashboard, { root }));
      await waitUntilExit();
    });
}
