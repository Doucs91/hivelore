import { Command } from "commander";
import { registerBriefing } from "./commands/briefing.js";
import { registerTui } from "./commands/tui.js";
import { registerEmbeddings } from "./commands/embeddings.js";
import { registerIndexCode } from "./commands/index-code.js";
import { registerInit } from "./commands/init.js";
import { registerInstallHooks } from "./commands/install-hooks.js";
import { registerObserve } from "./commands/observe.js";
import { registerMcp } from "./commands/mcp.js";
import { registerSync } from "./commands/sync.js";
import { registerMemoryAdd } from "./commands/memory-add.js";
import { registerMemoryList } from "./commands/memory-list.js";
import { registerMemoryPromote } from "./commands/memory-promote.js";
import { registerMemoryApprove } from "./commands/memory-approve.js";
import { registerMemoryUpdate } from "./commands/memory-update.js";
import { registerMemoryAutoPromote } from "./commands/memory-auto-promote.js";
import { registerMemoryEdit } from "./commands/memory-edit.js";
import { registerMemoryForFiles } from "./commands/memory-for-files.js";
import { registerMemoryHot } from "./commands/memory-hot.js";
import { registerMemoryTried } from "./commands/memory-tried.js";
import { registerMemorySeed } from "./commands/memory-seed.js";
import { registerMemoryPending } from "./commands/memory-pending.js";
import { registerMemoryQuery } from "./commands/memory-query.js";
import { registerMemoryReject } from "./commands/memory-reject.js";
import { registerMemoryRm } from "./commands/memory-rm.js";
import { registerMemoryShow } from "./commands/memory-show.js";
import { registerMemoryStats } from "./commands/memory-stats.js";
import { registerMemoryVerify } from "./commands/memory-verify.js";
import { registerMemoryImport } from "./commands/memory-import.js";
import { registerMemoryImportChangelog } from "./commands/memory-import-changelog.js";
import { registerMemoryDigest } from "./commands/memory-digest.js";
import { registerSessionEnd } from "./commands/session-end.js";
import { registerSnapshot } from "./commands/snapshot.js";
import { registerHub } from "./commands/hub.js";
import { registerStats } from "./commands/stats.js";
import { registerBench } from "./commands/bench.js";
import { registerBenchmark } from "./commands/benchmark.js";
import { registerMemorySuggest } from "./commands/memory-suggest.js";
import { registerMemoryArchive } from "./commands/memory-archive.js";
import { registerDoctor } from "./commands/doctor.js";
import { registerPlayback } from "./commands/playback.js";
import { registerPrecommit } from "./commands/precommit.js";
import { registerWelcome } from "./commands/welcome.js";
import { registerMemoryLint } from "./commands/memory-lint.js";
import { registerMemorySuggestTopic } from "./commands/memory-suggest-topic.js";
import { registerResolveProject } from "./commands/resolve-project.js";
import { registerRuntime } from "./commands/runtime-journal.js";
import { registerMemoryTimeline } from "./commands/memory-timeline.js";
import { registerMemoryConflictCandidates } from "./commands/memory-conflict-candidates.js";
import { registerEnforce } from "./commands/enforce.js";
import { registerRun } from "./commands/run.js";
import { registerAgent } from "./commands/agent.js";

const program = new Command();

declare const __HAIVE_VERSION__: string;

program
  .name("haive")
  .description("hAIve — the memory and enforcement layer of your agent harness")
  .version(__HAIVE_VERSION__)
  .option("--advanced", "show maintenance and experimental commands in help");

registerInit(program);
registerWelcome(program);
registerResolveProject(program);
registerRuntime(program);
registerEnforce(program);
registerRun(program);
registerAgent(program);

registerMcp(program);
registerBriefing(program);
registerTui(program);
registerEmbeddings(program);
registerSync(program);
registerInstallHooks(program);
registerObserve(program);
registerIndexCode(program);

const memory = program.command("memory").description("Manage memory entries");
registerMemoryAdd(memory);
registerMemoryList(memory);
registerMemoryQuery(memory);
registerMemoryPromote(memory);
registerMemoryVerify(memory);
registerMemoryStats(memory);
registerMemoryReject(memory);
registerMemoryAutoPromote(memory);
registerMemoryForFiles(memory);
registerMemoryShow(memory);
registerMemoryEdit(memory);
registerMemoryRm(memory);
registerMemoryPending(memory);
registerMemoryApprove(memory);
registerMemoryUpdate(memory);
registerMemoryHot(memory);
registerMemoryTried(memory);
registerMemorySeed(memory);
registerMemoryImport(memory);
registerMemoryImportChangelog(memory);
registerMemoryDigest(memory);
registerMemorySuggest(memory);
registerMemorySuggestTopic(memory);
registerMemoryTimeline(memory);
registerMemoryConflictCandidates(memory);
registerMemoryArchive(memory);
registerMemoryLint(memory);

const session = program.command("session").description(
  "Manage session lifecycle.\n\n" +
  "  Session start is automatic — hAIve loads context via `get_briefing` at the start\n" +
  "  of each agent session (Claude Code SessionStart hook or MCP first call).\n" +
  "  Use `haive session end` to save a rich end-of-session recap for the next session.",
);
registerSessionEnd(session);

registerSnapshot(program);
registerHub(program);
registerStats(program);
registerBench(program);
registerBenchmark(program);
registerDoctor(program);
registerPlayback(program);
registerPrecommit(program);

// The core harness loop only — what a developer actually types day to day. Everything else
// (tui dashboard, welcome onboarding, the manual `precommit` variant of `enforce check`, plus the
// maintenance/experimental families) stays one `--advanced` away. A focused surface is part of the
// positioning: hAIve is the anti-convention-hallucination layer, not a 54-command Swiss army knife.
const CORE_ROOT_COMMANDS = new Set([
  "init",
  "doctor",
  "agent",
  "briefing",
  "enforce",
  "run",
  "sync",
  "mcp",
  "memory",
  "session",
]);

const CORE_MEMORY_COMMANDS = new Set([
  "add",
  "list",
  "query",
  "show",
  "verify",
  "lint",
  "tried",
  "rm",
]);

const CORE_SESSION_COMMANDS = new Set(["end"]);

applySurfaceVisibility(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (isZodError(err)) {
    for (const issue of err.issues) {
      const field = issue.path.length > 0 ? `${String(issue.path.join("."))}: ` : "";
      console.error(`\x1b[31m✗\x1b[0m ${field}${issue.message}`);
    }
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});

function applySurfaceVisibility(root: Command): void {
  const showAdvanced =
    process.argv.includes("--advanced") || process.env.HAIVE_SHOW_ADVANCED === "1";

  if (!showAdvanced) hideNonCoreCommands(root);

  root.addHelpText(
    "after",
    [
      "",
      "Default help shows the core harness workflow: init, doctor, agent setup, briefing, enforcement,",
      "sync, session recaps, and high-signal memory commands.",
      "Run `haive --advanced --help` or set HAIVE_SHOW_ADVANCED=1 to show maintenance and experimental commands.",
    ].join("\n"),
  );
  const memoryCommand = root.commands.find((cmd) => cmd.name() === "memory");
  memoryCommand?.addHelpText(
    "after",
    [
      "",
      "Default help shows the memory commands that support the core harness workflow.",
      "Run `haive --advanced memory --help` or set HAIVE_SHOW_ADVANCED=1 to show review, import, digest, timeline, and conflict tools.",
    ].join("\n"),
  );
}

function hideNonCoreCommands(command: Command): void {
  for (const child of command.commands) {
    if (!isCoreCommand(command, child)) {
      (child as unknown as { _hidden: boolean })._hidden = true;
    }
    hideNonCoreCommands(child);
  }
}

function isCoreCommand(parent: Command, child: Command): boolean {
  const parentName = parent.name();
  const childName = child.name();
  if (parentName === "haive") return CORE_ROOT_COMMANDS.has(childName);
  if (parentName === "memory") return CORE_MEMORY_COMMANDS.has(childName);
  if (parentName === "session") return CORE_SESSION_COMMANDS.has(childName);
  return true;
}

function isZodError(
  err: unknown,
): err is { issues: Array<{ path: unknown[]; message: string }> } {
  return (
    err !== null &&
    typeof err === "object" &&
    "issues" in err &&
    Array.isArray((err as Record<string, unknown>).issues)
  );
}
