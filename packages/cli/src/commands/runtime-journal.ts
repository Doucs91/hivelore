import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  appendRuntimeJournalEntry,
  findProjectRoot,
  readRuntimeJournalTail,
  resolveHaivePaths,
  type RuntimeJournalEntry,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

interface JournalAppendOpts {
  kind: string;
  dir?: string;
}

export function registerRuntime(program: Command): void {
  const runtime = program
    .command("runtime")
    .description(
      "Local-only .ai/.runtime helpers (not versioned team memory). See session-journal.ndjson.",
    );

  const journal = runtime
    .command("journal")
    .description("Append or read the machine-local session journal (NDJSON)");

  journal
    .command("append")
    .description("Append one JSON line to .ai/.runtime/session-journal.ndjson")
    .argument("<message>", "short text to log")
    .option("-k, --kind <kind>", "note | session_end | mcp", "note")
    .option("-d, --dir <dir>", "project root", process.cwd())
    .action(async (message: string, opts: JournalAppendOpts) => {
      const root = path.resolve(opts.dir ?? process.cwd());
      const paths = resolveHaivePaths(findProjectRoot(root));
      const raw = opts.kind ?? "note";
      const kind = (["note", "session_end", "mcp"].includes(raw)
        ? raw
        : "note") as RuntimeJournalEntry["kind"];
      await appendRuntimeJournalEntry(paths, { kind, message });
      ui.success(`Appended to ${path.relative(root, paths.runtimeDir)}/session-journal.ndjson`);
    });

  journal
    .command("tail")
    .description("Print the last N entries from the runtime session journal as JSON")
    .option("-n, --limit <n>", "number of lines", "30")
    .option("-d, --dir <dir>", "project root", process.cwd())
    .action(async (opts: { limit: string; dir?: string }) => {
      const root = path.resolve(opts.dir ?? process.cwd());
      const paths = resolveHaivePaths(findProjectRoot(root));
      const limit = Math.min(500, Math.max(1, parseInt(opts.limit, 10) || 30));
      if (!existsSync(paths.haiveDir)) {
        ui.error("No .ai/ — run `hivelore init` first.");
        process.exitCode = 1;
        return;
      }
      const entries = await readRuntimeJournalTail(paths, limit);
      if (entries.length === 0) {
        ui.info("Journal empty or missing.");
        return;
      }
      console.log(JSON.stringify({ entries, count: entries.length }, null, 2));
    });
}
