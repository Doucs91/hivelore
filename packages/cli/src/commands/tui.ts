import { Command } from "commander";
import { findProjectRoot } from "@hiveai/core";

export function registerTui(program: Command): void {
  program
    .command("tui")
    .description("Interactive TUI dashboard — browse, filter, and manage memories in the terminal")
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
