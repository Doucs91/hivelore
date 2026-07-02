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
import { registerMemoryImpact } from "./commands/memory-impact.js";
import { registerMemoryFeedback } from "./commands/memory-feedback.js";
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
import { registerEval } from "./commands/eval.js";
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
import { registerSensors } from "./commands/sensors.js";
import { registerIngest } from "./commands/ingest.js";
import { registerDashboard } from "./commands/dashboard.js";
import { registerDevLink } from "./commands/dev-link.js";
import { registerCoverage } from "./commands/coverage.js";
import { registerMergeDriver } from "./commands/merge-driver.js";
import { registerMemoryResolveConflict } from "./commands/memory-resolve-conflict.js";
import { registerMemorySeedGit } from "./commands/memory-seed-git.js";
// --- Lot C ---
import { registerBridges } from "./commands/bridges.js";

const program = new Command();

declare const __HAIVE_VERSION__: string;

program
  .name("haive")
  .description("hAIve - repo-native memory and context policy for coding-agent harnesses")
  .version(__HAIVE_VERSION__)
  .option("--advanced", "show maintenance and experimental commands in help")
  // Agents guess flags by analogy (`--content` for `--body`, `--summary` for `--goal`) and a
  // bare "unknown option" dead-ends them. Must run BEFORE the register* calls so subcommands
  // created via program.command() inherit the setting.
  .showSuggestionAfterError(true);

registerInit(program);
registerWelcome(program);
registerResolveProject(program);
registerRuntime(program);
registerEnforce(program);
registerRun(program);
registerAgent(program);
registerSensors(program);
registerIngest(program);
registerDashboard(program);
registerCoverage(program);
registerMergeDriver(program);
registerDevLink(program);

registerMcp(program);
registerBriefing(program);
registerTui(program);
registerEmbeddings(program);
registerSync(program);
registerBridges(program); // --- Lot C ---
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
registerMemoryImpact(memory);
registerMemoryFeedback(memory);
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
registerMemorySeedGit(memory);
registerMemoryResolveConflict(memory);
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
registerEval(program);
registerDoctor(program);
registerPlayback(program);
registerPrecommit(program);

// The core harness loop only — what a developer actually types day to day. Everything else
// (tui dashboard, welcome onboarding, the manual `precommit` variant of `enforce check`, plus the
// maintenance/experimental families) stays one `--advanced` away. A focused surface is part of the
// positioning: hAIve is repo context policy for coding-agent harnesses, not a 54-command Swiss army knife.
const CORE_ROOT_COMMANDS = new Set([
  "init",
  "doctor",
  "agent",
  "briefing",
  "bridges", // --- Lot C ---
  "enforce",
  "run",
  "sensors",
  "sync",
  "mcp",
  "memory",
  "session",
]);

// Canonical verbs mirror the MCP tool names (mem_save / mem_search / mem_get / mem_delete)
// so an agent learns one vocabulary across both façades. Old verbs (add/query/show/rm) stay
// as command aliases, so existing scripts keep working.
const CORE_MEMORY_COMMANDS = new Set([
  "save",
  "list",
  "search",
  "get",
  "verify",
  "lint",
  "tried",
  "delete",
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

  // Families block lists advanced command names, so it only shows in advanced help —
  // the default help stays focused on the golden path (those names would otherwise leak
  // into the core surface).
  const familiesBlock = showAdvanced
    ? [
        "",
        "Advanced surface, by family:",
        "  reports:  dashboard · stats · playback        eval:     eval · benchmark · selftest (alias: bench)",
        "  index:    index · code-search · embeddings    runtime:  runtime · observe · snapshot",
        "  ops:      memory <sub> · sensors · ingest · hub · sync · install-hooks (= enforce install) · precommit (= enforce check)",
      ]
    : [];
  root.addHelpText(
    "after",
    [
      "",
      "Golden path (what you type day to day):",
      "  init → doctor → agent setup → briefing → memory save/tried → sensors check → enforce finish → sync → session end",
      "",
      "Memory verbs mirror the MCP tools: memory save/search/get/delete <-> mem_save/mem_search/mem_get/mem_delete",
      "(old verbs add/query/show/rm still work as aliases).",
      ...familiesBlock,
      "",
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
