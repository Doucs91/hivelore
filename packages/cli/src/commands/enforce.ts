import { execFileSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  antiPatternGateParams,
  BRIDGE_TARGET_PATH,
  findProjectRoot,
  findUncapturedFailures,
  hasRecentBriefingMarker,
  isFreshIsoDate,
  isRetiredMemory,
  loadConfig,
  loadMemoriesFromDir,
  memoryMatchesAnchorPaths,
  readRecentBriefingMarker,
  resolveBriefingBudget,
  resolveHaivePaths,
  runSensors,
  saveConfig,
  sensorTargetsFromDiff,
  SESSION_RECAP_TTL_MS,
  verifyAnchor,
  writeBriefingMarker,
  type AntiPatternGate,
  type LoadedMemory,
  type HaiveConfig,
} from "@hiveai/core";
import { getBriefing, preCommitCheck } from "@hiveai/mcp";
import { ui } from "../utils/ui.js";
import { installClaudeHooksAtPath, defaultClaudeSettingsPath } from "../utils/claude-hooks.js";
import { applyAutopilotRepairs } from "../utils/autopilot.js";

declare const __HAIVE_VERSION__: string;

const MAX_STDIN_BYTES = 256 * 1024;
const ENFORCE_HOOK_MARKER = "# hAIve enforcement hook";

interface HookPayload {
  cwd?: string;
  session_id?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

interface EnforceOptions {
  dir?: string;
  task?: string;
  source?: string;
  sessionId?: string;
  json?: boolean;
  stage?: "local" | "pre-commit" | "pre-push" | "ci";
  strict?: boolean;
  claude?: boolean;
  git?: boolean;
  ci?: boolean;
  explain?: boolean;
}

interface FinishOptions {
  dir?: string;
  json?: boolean;
  explain?: boolean;
}

interface EnforcementFinding {
  severity: "ok" | "info" | "warn" | "error";
  code: string;
  message: string;
  fix?: string;
  impact?: number;
  reason?: string;
  affected_files?: string[];
  memory_ids?: string[];
}

interface EnforcementScore {
  score: number;
  threshold: number;
  checks: {
    total: number;
    ok: number;
    warn: number;
    error: number;
  };
}

interface EnforcementReport {
  root: string;
  initialized: boolean;
  mode: "off" | "advisory" | "strict";
  score: EnforcementScore;
  should_block: boolean;
  findings: EnforcementFinding[];
  categories: {
    blocking: EnforcementFinding[];
    review: EnforcementFinding[];
    info: EnforcementFinding[];
  };
}

export function registerEnforce(program: Command): void {
  const enforce = program
    .command("enforce")
    .description(
      "Agent-agnostic enforcement helpers: install policy gates, report status, and block unsafe workflows.",
    );

  enforce
    .command("install")
    .description("Install hAIve enforcement across MCP config, git hooks, CI template, and supported client hooks.")
    .option("-d, --dir <dir>", "project root")
    .option("--no-git", "skip git pre-commit/pre-push enforcement hooks")
    .option("--no-claude", "skip Claude Code hooks")
    .option("--no-ci", "skip GitHub Actions enforcement workflow")
    .action(async (opts: EnforceOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      await mkdir(paths.haiveDir, { recursive: true });
      const current = await loadConfig(paths);
      await saveConfig(paths, {
        ...current,
        enforcement: {
          ...current.enforcement,
          mode: "strict",
          requireBriefingFirst: true,
          requireSessionRecap: true,
          requireMemoryVerify: true,
          blockStaleDecisionChanges: true,
          requireDecisionCoverage: true,
          scoreThreshold: 85,
          cleanupGeneratedArtifacts: true,
          toolProfile: "enforcement",
          policyPacks: ["architecture", "gotchas", "security", "domain", "release"],
        },
      });
      ui.success("hAIve strict enforcement enabled in .ai/haive.config.json");

      if (opts.git !== false) await installGitEnforcement(root);
      if (opts.ci !== false) await installCiEnforcement(root);
      if (opts.claude !== false) {
        try {
          const result = await installClaudeHooksAtPath(defaultClaudeSettingsPath("project", root));
          ui.success(`${result.created ? "Created" : "Patched"} Claude Code hooks (${path.relative(root, result.settingsPath)})`);
        } catch (err) {
          ui.warn(`Claude Code hooks not installed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      ui.info("Agent-agnostic gates are now active at workflow level: MCP, git, CI, and optional client hooks.");
      ui.info("Use `haive run -- <agent command>` for agents that do not expose blocking hooks.");
    });

  enforce
    .command("status")
    .description("Show whether this project has agent-agnostic hAIve enforcement installed.")
    .option("-d, --dir <dir>", "project root")
    .option("--explain", "group findings by blocking/review/info and show repair commands", false)
    .option("--json", "emit JSON", false)
    .action(async (opts: EnforceOptions) => {
      const report = await buildEnforcementReport(opts.dir, "local");
      printReport(report, Boolean(opts.json), Boolean(opts.explain));
      if (report.should_block) process.exitCode = 1;
    });

  enforce
    .command("check")
    .description("Run the hAIve policy gate. Intended for pre-commit, pre-push, wrappers, and any agent client.")
    .option("-d, --dir <dir>", "project root")
    .option("--stage <stage>", "local | pre-commit | pre-push | ci", "local")
    .option("--explain", "group findings by blocking/review/info and show repair commands", false)
    .option("--json", "emit JSON", false)
    .action(async (opts: EnforceOptions) => {
      const report = await buildEnforcementReport(opts.dir, opts.stage ?? "local");
      printReport(report, Boolean(opts.json), Boolean(opts.explain));
      if (report.should_block) process.exit(2);
    });

  enforce
    .command("cleanup")
    .description("Remove generated hAIve runtime/cache artifacts that should not appear in commits.")
    .option("-d, --dir <dir>", "project root")
    .option("--dry-run", "print what would be removed without deleting", false)
    .action(async (opts: EnforceOptions & { dryRun?: boolean }) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const cacheDir = path.join(paths.haiveDir, ".cache");
      if (existsSync(cacheDir)) {
        if (opts.dryRun) ui.info(`would clean ${path.relative(root, cacheDir)} (preserving .gitignore)`);
        else {
          const removed = await cleanupCacheDir(cacheDir);
          ui.success(`cleaned ${path.relative(root, cacheDir)}${removed > 0 ? ` (${removed} item${removed === 1 ? "" : "s"} removed)` : ""}`);
        }
      }
      if (existsSync(paths.runtimeDir)) {
        if (opts.dryRun) ui.info(`would clean ${path.relative(root, paths.runtimeDir)} (preserving briefing markers)`);
        else {
          const removed = await cleanupRuntimeDir(paths.runtimeDir);
          ui.success(`cleaned ${path.relative(root, paths.runtimeDir)}${removed > 0 ? ` (${removed} item${removed === 1 ? "" : "s"} removed)` : ""}`);
        }
      }
    });

  enforce
    .command("ci")
    .description("CI entrypoint: fail if the repository violates hAIve enforcement policy.")
    .option("-d, --dir <dir>", "project root")
    .option("--explain", "group findings by blocking/review/info and show repair commands", false)
    .option("--json", "emit JSON", false)
    .action(async (opts: EnforceOptions) => {
      const report = await buildEnforcementReport(opts.dir, "ci");
      printReport(report, Boolean(opts.json), Boolean(opts.explain));
      if (report.should_block) process.exit(2);
    });

  enforce
    .command("finish")
    .alias("completion")
    .description(
      "Final agent-exit gate: verify the git sync/release protocol before reporting a task done.",
    )
    .option("-d, --dir <dir>", "project root")
    .option("--explain", "group findings by blocking/review/info and show repair commands", false)
    .option("--json", "emit JSON", false)
    .action(async (opts: FinishOptions) => {
      const report = await buildFinishReport(opts.dir);
      printReport(report, Boolean(opts.json), Boolean(opts.explain));
      if (report.should_block) {
        if (!opts.json) printNextRequiredAction(report);
        process.exit(2);
      }
    });

  enforce
    .command("commit-msg <msgfile>")
    .description(
      "git commit-msg hook: block a CI-skip directive in a commit that also changes shippable code " +
      "(GitHub scans the whole message and would skip CI for the entire push). `.ai/`-only sync commits are allowed.",
    )
    .option("-d, --dir <dir>", "project root")
    .action(async (msgfile: string, opts: EnforceOptions) => {
      const root = findProjectRoot(opts.dir);
      const verdict = await checkCommitMessageSkipCi(root, msgfile);
      if (verdict.block) {
        ui.error(verdict.message);
        process.exit(1);
      }
    });

  enforce
    .command("session-start")
    .description("Claude Code SessionStart hook: inject briefing and write a local briefing marker.")
    .option("-d, --dir <dir>", "project root")
    .option("--task <text>", "task text to rank memories")
    .option("--source <name>", "marker source", "claude-session-start")
    .option("--session-id <id>", "agent session id")
    .action(async (opts: EnforceOptions) => {
      const payload = await readHookPayload();
      const root = resolveRoot(opts.dir, payload);
      if (!root) return;
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) return;
      await mkdir(paths.runtimeDir, { recursive: true });
      const sessionId = opts.sessionId ?? payload.session_id;
      const task = opts.task ?? payload.prompt ?? "Start an AI coding session in this hAIve-initialized project.";
      await applyLightweightRepairs(root, paths);

      const budget = resolveBriefingBudget("quick", {
        max_tokens: 2500,
        max_memories: 5,
        include_module_contexts: false,
      });
      const briefing = await getBriefing(
        {
          task,
          files: [],
          max_tokens: budget.max_tokens,
          max_memories: budget.max_memories,
          include_project_context: true,
          include_module_contexts: budget.include_module_contexts,
          semantic: true,
          include_stale: false,
          track: true,
          format: "actions",
          symbols: [],
          min_semantic_score: 0.25,
          budget_preset: "quick",
        },
        { paths },
      );
      await writeBriefingMarker(paths, {
        sessionId,
        task,
        source: opts.source ?? "claude-session-start",
        memoryIds: briefing.memories.map((m) => m.id),
      });

      console.log("hAIve briefing loaded. Agents must consult this before editing.");
      if (briefing.last_session) {
        console.log(`\n## Last session\n${briefing.last_session.body.slice(0, 1200)}`);
      }
      if (briefing.project_context?.content) {
        console.log(`\n## Project context\n${briefing.project_context.content.slice(0, 1800)}`);
      }
      if (briefing.memories.length > 0) {
        console.log("\n## Relevant memories");
        for (const memory of briefing.memories.slice(0, 6)) {
          console.log(`\n### ${memory.id} (${memory.scope}/${memory.type}, ${memory.confidence})`);
          console.log(memory.body.slice(0, 1000));
        }
      }
      for (const warning of briefing.setup_warnings) {
        console.log(`\n[setup warning] ${warning}`);
      }
    });

  enforce
    .command("pre-tool-use")
    .description("Claude Code PreToolUse hook: surface the relevant team policy for the edited file (advise; configurable to block).")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: EnforceOptions) => {
      const payload = await readHookPayload();
      const root = resolveRoot(opts.dir, payload);
      if (!root) return;
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) return;
      if (!isWriteLikeTool(payload)) return;

      const config = await loadConfig(paths);
      if (config.enforcement?.requireBriefingFirst === false) return;
      const gate = config.enforcement?.preEditGate ?? "advise";

      const targetFiles = extractToolPaths(payload, root);
      const hasMarker = await hasRecentBriefingMarker(paths, payload.session_id);
      const missing = targetFiles.length > 0
        ? await missingRequiredMemoriesForFiles(paths, targetFiles, payload.session_id)
        : [];

      // Clean pass: a recent briefing exists and the touched files carry no un-surfaced policy.
      if (hasMarker && missing.length === 0) return;

      // Auto-resolve: record the relevant policy for the touched files into the briefing marker so
      // the agent gets credit for it AND the commit-time decision-coverage gate accumulates coverage
      // as the agent edits — no separate `haive briefing` command needed.
      if (targetFiles.length > 0) {
        await recordFilesIntoBriefingMarker(paths, targetFiles, missing, payload.session_id)
          .catch(() => { /* best-effort */ });
      }

      const contextText = buildPreEditContext(payload.tool_name ?? "write tool", targetFiles, missing, hasMarker);

      if (gate === "block") {
        // Legacy strict behaviour: block — but with the actual content and no separate command.
        // The relevant policy is already recorded, so simply re-issuing the edit passes.
        console.error(
          contextText +
          "\n\nThe relevant context is now recorded — re-issue the same edit to proceed " +
          "(no `haive briefing` command needed). To make this advisory instead of blocking, set " +
          '`{ "enforcement": { "preEditGate": "advise" } }` in .ai/haive.config.json.',
        );
        process.exit(2);
      }

      // advise (default): inject the context into the agent and ALLOW the edit — zero round-trip.
      // Commit-time decision-coverage + CI enforcement remain the hard backstops.
      emitPreToolUseContext(contextText);
    });
}

/**
 * Record the validated policy memories anchored to the touched files into the briefing marker,
 * unioned with whatever is already there. Mirrors what `haive briefing --files` records, so the
 * commit-time decision-coverage gate accumulates coverage as the agent edits (no broad re-briefing).
 */
async function recordFilesIntoBriefingMarker(
  paths: ReturnType<typeof resolveHaivePaths>,
  files: string[],
  missing: LoadedMemory[],
  sessionId?: string,
): Promise<void> {
  const existing = await readRecentBriefingMarker(paths, sessionId);
  const ids = new Set<string>(existing?.memory_ids ?? []);
  for (const { memory } of missing) ids.add(memory.frontmatter.id);
  await writeBriefingMarker(paths, {
    sessionId,
    task: existing?.task ?? "pre-edit auto-briefing",
    source: "haive-pre-edit",
    files,
    memoryIds: [...ids],
  });
}

/** Build the context block surfaced to the agent at edit time (the actual memory bodies). */
function buildPreEditContext(
  tool: string,
  files: string[],
  missing: LoadedMemory[],
  hasMarker: boolean,
): string {
  const lines: string[] = ["hAIve — relevant team policy for this edit", `Tool: ${tool}`];
  if (files.length > 0) lines.push(`Files: ${files.slice(0, 6).join(", ")}`);
  if (missing.length > 0) {
    lines.push("", "Consult these before editing (anchored to the files you are touching):");
    for (const { memory } of missing.slice(0, 5)) {
      const fm = memory.frontmatter;
      lines.push("", `### ${fm.id}  (${fm.scope}/${fm.type})`, memory.body.trim().slice(0, 900));
    }
  } else if (!hasMarker) {
    lines.push(
      "",
      "No team briefing was loaded yet this session. Proceeding — but for substantive work call " +
      "get_briefing / mem_relevant_to for richer context.",
    );
  }
  return lines.join("\n");
}

/** Emit a Claude Code PreToolUse hook result that injects context for the model WITHOUT blocking. */
function emitPreToolUseContext(text: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: text,
      },
    }),
  );
}

async function buildFinishReport(dir: string | undefined): Promise<EnforcementReport> {
  const root = findProjectRoot(dir);
  const paths = resolveHaivePaths(root);
  const initialized = existsSync(paths.haiveDir);
  const config = initialized ? await loadConfig(paths) : {};
  const mode = config.enforcement?.mode ?? "strict";
  const findings: EnforcementFinding[] = [];

  if (!initialized) {
    return withCategories({
      root,
      initialized,
      mode,
      score: buildScore([], config.enforcement?.scoreThreshold),
      should_block: true,
      findings: [{
        severity: "error",
        code: "not-initialized",
        message: "This repository is not initialized with hAIve.",
        fix: "Run `haive init` or `haive enforce install`.",
        impact: 100,
      }],
    });
  }

  findings.push(...await checkFailureCapture(paths, config));

  const status = await getGitSyncStatus(root);
  if (!status.available) {
    findings.push({
      severity: "error",
      code: "git-unavailable",
      message: "Git status could not be inspected, so hAIve cannot verify the exit protocol.",
      fix: "Run `git status` manually, then commit/push according to the hAIve git-sync protocol.",
      impact: 100,
    });
    return finishReport(root, initialized, mode, findings, config);
  }

  const shippableDirty = status.dirtyFiles.filter(isShippablePath);
  if (status.dirtyFiles.length > 0) {
    findings.push({
      severity: "error",
      code: shippableDirty.length > 0 ? "git-sync-uncommitted-shippable" : "git-sync-uncommitted-changes",
      message: shippableDirty.length > 0
        ? `${shippableDirty.length} shippable file(s) are modified but not committed.`
        : `${status.dirtyFiles.length} file(s) are modified but not committed.`,
      fix: shippableDirty.length > 0
        ? "Bump the lockstep package version if needed, then `git add`, `git commit`, `git tag vX.Y.Z`, `git push && git push origin vX.Y.Z` (not `--tags`)."
        : "Commit and push these changes before reporting the task done.",
      reason: "The multi-agent git-sync decision requires agents to leave completed work committed and pushed, not as a local diff.",
      affected_files: status.dirtyFiles.slice(0, 12),
      impact: 100,
    });
    return finishReport(root, initialized, mode, findings, config);
  }

  findings.push({
    severity: "ok",
    code: "git-worktree-clean",
    message: "No uncommitted worktree changes remain.",
  });

  if (!status.upstream) {
    findings.push({
      severity: "warn",
      code: "git-sync-no-upstream",
      message: "This branch has no upstream, so hAIve cannot verify that commits/tags were pushed.",
      fix: "Set an upstream with `git push -u origin <branch>`.",
      impact: 15,
    });
    return finishReport(root, initialized, mode, findings, config);
  }

  if (status.behind > 0) {
    findings.push({
      severity: "error",
      code: "git-sync-behind-upstream",
      message: `This branch is ${status.behind} commit(s) behind ${status.upstream}.`,
      fix: "Run `git pull --ff-only` and resolve any conflicts before finishing.",
      impact: 40,
    });
  }

  if (status.ahead > 0) {
    findings.push({
      severity: "error",
      code: "git-sync-unpushed-commits",
      message: `This branch is ${status.ahead} commit(s) ahead of ${status.upstream}.`,
      fix: "Run `git push` before reporting the task done.",
      reason: "The multi-agent git-sync decision requires agents to push completed commits.",
      impact: 60,
    });
  } else {
    findings.push({
      severity: "ok",
      code: "git-sync-pushed",
      message: `Branch is not ahead of ${status.upstream}.`,
    });
  }

  const releaseChangedFiles = status.releaseChangedFiles ?? status.changedSinceUpstream;
  const releaseBaseRef = status.releaseBaseRef ?? status.upstream;
  const shippableChanged = releaseChangedFiles.filter(isShippablePath);
  if (shippableChanged.length === 0) {
    findings.push({
      severity: "ok",
      code: "release-version-not-required",
      message: "No shippable package code changed since upstream; no version/tag required.",
    });
    findings.push(...await verifyGithubActionsForHead(root, status));
    return finishReport(root, initialized, mode, findings, config);
  }

  findings.push({
    severity: "info",
    code: "release-shippable-changes",
    message: `${shippableChanged.length} shippable file(s) changed since ${releaseBaseRef}.`,
    affected_files: shippableChanged.slice(0, 12),
  });

  // Release discipline (version bump + tag) is a HARD gate only on the configured release branch.
  // On feature/* or an integration branch like `develop`, the bump/tag happen when releasing from
  // that branch — so here the same findings are advisory (warn), never blocking the agent's exit.
  const releaseBranch = config.enforcement?.releaseBranch ?? "main";
  const onReleaseBranch = !status.branch || status.branch === releaseBranch;
  const releaseSeverity: EnforcementFinding["severity"] = onReleaseBranch ? "error" : "warn";
  const offBranchNote = onReleaseBranch
    ? ""
    : ` (advisory on '${status.branch}'; enforced when releasing from '${releaseBranch}')`;

  const versionState = await inspectReleaseVersionState(root, releaseBaseRef);
  if (!versionState.lockstep) {
    findings.push({
      severity: "error",
      code: "release-version-not-lockstep",
      message: `Publishable package versions are not in lockstep: ${versionState.localVersionsLabel}.`,
      fix: "Set root, core, cli, mcp, and embeddings package.json versions to the same X.Y.Z.",
      impact: 60,
    });
    return finishReport(root, initialized, mode, findings, config);
  }

  const version = versionState.version;
  if (!version) {
    findings.push({
      severity: "error",
      code: "release-version-unreadable",
      message: "Could not read the lockstep package version.",
      fix: "Verify package.json files are valid JSON.",
      impact: 60,
    });
    return finishReport(root, initialized, mode, findings, config);
  }

  if (versionState.baseVersion && compareSemver(version, versionState.baseVersion) <= 0) {
    findings.push({
      severity: releaseSeverity,
      code: "release-version-missing",
      message: `Shippable code changed, but version stayed at ${version} (base: ${versionState.baseVersion})${offBranchNote}.`,
      fix: "Bump the lockstep package version (patch by default), commit the bump, tag it, then push code and tags.",
      impact: onReleaseBranch ? 70 : 0,
    });
  } else {
    findings.push({
      severity: "ok",
      code: "release-version-bumped",
      message: versionState.baseVersion
        ? `Lockstep version bumped from ${versionState.baseVersion} to ${version}.`
        : `Lockstep version is ${version}.`,
    });
  }

  const tag = `v${version}`;
  const localTagAtHead = await tagPointsAtHead(root, tag);
  if (!localTagAtHead) {
    findings.push({
      severity: releaseSeverity,
      code: "release-tag-missing",
      message: `Expected git tag ${tag} to point at HEAD${offBranchNote}.`,
      fix: `Run \`git tag ${tag}\` after committing the version bump.`,
      impact: onReleaseBranch ? 50 : 0,
    });
  } else {
    findings.push({
      severity: "ok",
      code: "release-tag-present",
      message: `Tag ${tag} points at HEAD.`,
    });
  }

  const remoteTag = await remoteTagExists(root, tag);
  if (remoteTag === false) {
    findings.push({
      severity: releaseSeverity,
      code: "release-tag-unpushed",
      message: `Tag ${tag} is not present on the remote${offBranchNote}.`,
      fix: `Run \`git push origin ${tag}\` (avoid \`git push --tags\` — it fails on pre-existing divergent tags).`,
      impact: onReleaseBranch ? 50 : 0,
    });
  } else if (remoteTag === true) {
    findings.push({
      severity: "ok",
      code: "release-tag-pushed",
      message: `Tag ${tag} exists on the remote.`,
    });
  } else {
    findings.push({
      severity: "warn",
      code: "release-tag-remote-unverified",
      message: `Could not verify whether tag ${tag} exists on the remote.`,
      fix: `Run \`git push origin ${tag}\` if you have not already (avoid \`git push --tags\`).`,
      impact: 10,
    });
  }

  findings.push(...await verifyGithubActionsForHead(root, status));
  return finishReport(root, initialized, mode, findings, config);
}

/**
 * Failure-capture gate: hard failures observed this session (`haive observe` tagged them
 * `failure_hint`) that were never written down as a lesson are a silent-repeat risk. Surface them
 * (gate=warn, default) or block finish (gate=block). A failure is "captured" once an attempt/gotcha
 * lesson was recorded after it. Off by config opt-out — the signal has false positives (a `grep`
 * that finds nothing exits non-zero), so the default is advisory, not blocking.
 */
async function checkFailureCapture(
  paths: ReturnType<typeof resolveHaivePaths>,
  config: HaiveConfig,
): Promise<EnforcementFinding[]> {
  const gate = config.enforcement?.failureCaptureGate ?? "warn";
  if (gate === "off") return [];

  const obsFile = path.join(paths.haiveDir, ".cache", "observations.jsonl");
  if (!existsSync(obsFile)) return [];

  const failures: { ts: string; tool: string; summary: string }[] = [];
  try {
    const raw = await readFile(obsFile, "utf8");
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const o = JSON.parse(trimmed) as { ts?: string; tool?: string; summary?: string; failure_hint?: boolean };
        if (o.failure_hint && o.ts) failures.push({ ts: o.ts, tool: o.tool ?? "?", summary: o.summary ?? "" });
      } catch { /* skip corrupt line */ }
    }
  } catch {
    return [];
  }
  if (failures.length === 0) return [];

  const memories = existsSync(paths.memoriesDir) ? await loadMemoriesFromDir(paths.memoriesDir) : [];
  const captureTimes = memories
    .filter(({ memory }) => ["attempt", "gotcha"].includes(memory.frontmatter.type))
    .map(({ memory }) => memory.frontmatter.created_at);

  const uncaptured = findUncapturedFailures(failures, captureTimes);
  if (uncaptured.length === 0) {
    return [{
      severity: "ok",
      code: "failure-capture-clean",
      message: "No uncaptured hard failures from this session.",
    }];
  }

  return [{
    severity: gate === "block" ? "error" : "info",
    code: "uncaptured-failures",
    message: `${uncaptured.length} hard failure(s) this session were never captured as a lesson (mem_tried).`,
    fix: "Call `mem_tried` (or `haive memory tried`) for each real failure so the next session doesn't repeat it. False positives (e.g. a grep that found nothing) can be ignored.",
    reason: "Harness ratchet: a mistake that isn't written down gets re-introduced. Set enforcement.failureCaptureGate to 'off' to disable, or 'block' to hard-fail.",
    affected_files: uncaptured.slice(0, 8).map((f) => `${f.tool}: ${f.summary}`.slice(0, 100)),
    ...(gate === "block" ? { impact: 30 } : {}),
  }];
}

function finishReport(
  root: string,
  initialized: boolean,
  mode: EnforcementReport["mode"],
  findings: EnforcementFinding[],
  config: HaiveConfig,
): EnforcementReport {
  const score = buildScore(findings, config.enforcement?.scoreThreshold);
  const hasErrors = findings.some((f) => f.severity === "error");
  return withCategories({
    root,
    initialized,
    mode,
    score,
    should_block: mode === "strict" && hasErrors,
    findings,
  });
}

export async function runWithEnforcement(
  command: string,
  args: string[],
  opts: { dir?: string; task?: string },
): Promise<void> {
  const root = findProjectRoot(opts.dir);
  const paths = resolveHaivePaths(root);
  if (!existsSync(paths.haiveDir)) {
    ui.error(`No .ai/ found at ${root}. Run \`haive init\` first.`);
    process.exit(1);
  }

  const sessionId = `haive-run-${process.pid}-${Date.now()}`;
  const task = opts.task ?? `Run agent command: ${[command, ...args].join(" ")}`;
  await writeBriefingMarker(paths, {
    sessionId,
    task,
    source: "haive-run",
  });
  const briefingFile = await writeWrapperBriefing(paths, sessionId, task);

  const before = await buildEnforcementReport(root, "local", sessionId);
  const blocking = before.findings.filter((f) => f.severity === "error" && f.code !== "session-recap-missing");
  if (blocking.length > 0) {
    printReport({ ...before, should_block: true, findings: blocking }, false);
    process.exit(2);
  }

  ui.info(`hAIve briefing marker created for wrapped agent session: ${sessionId}`);
  ui.info(`Briefing written to ${path.relative(root, briefingFile)} and exported as HAIVE_BRIEFING_FILE`);
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      HAIVE_PROJECT_ROOT: root,
      HAIVE_SESSION_ID: sessionId,
      HAIVE_BRIEFING_FILE: briefingFile,
      HAIVE_ENFORCEMENT: "strict",
      HAIVE_TOOL_PROFILE: process.env.HAIVE_TOOL_PROFILE ?? "enforcement",
    },
  });
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (signal) process.exit(128);
      process.exitCode = code ?? 0;
      resolve();
    });
  });
}

async function writeWrapperBriefing(
  paths: ReturnType<typeof resolveHaivePaths>,
  sessionId: string,
  task: string,
): Promise<string> {
  await applyLightweightRepairs(paths.root, paths);
  const budget = resolveBriefingBudget("quick", {
    max_tokens: 2500,
    max_memories: 5,
    include_module_contexts: false,
  });
  const briefing = await getBriefing({
    task,
    files: [],
    max_tokens: budget.max_tokens,
    max_memories: budget.max_memories,
    include_project_context: true,
    include_module_contexts: budget.include_module_contexts,
    semantic: true,
    include_stale: false,
    track: true,
    format: "actions",
    symbols: [],
    min_semantic_score: 0.25,
    budget_preset: "quick",
  }, { paths });
  await writeBriefingMarker(paths, {
    sessionId,
    task,
    source: "haive-run",
    memoryIds: briefing.memories.map((m) => m.id),
  });
  const dir = path.join(paths.runtimeDir, "enforcement", "briefings");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.md`);
  const parts = [
    "# hAIve Briefing",
    "",
    `Task: ${task}`,
    "",
  ];
  if (briefing.last_session) parts.push("## Last Session", briefing.last_session.body.trim(), "");
  if (briefing.project_context?.content) parts.push("## Project Context", briefing.project_context.content.trim(), "");
  if (briefing.memories.length > 0) {
    parts.push("## Relevant Memories");
    for (const memory of briefing.memories) {
      parts.push("", `### ${memory.id}`, memory.body.trim());
    }
  }
  if (briefing.setup_warnings.length > 0) {
    parts.push("", "## Setup Warnings", ...briefing.setup_warnings.map((w) => `- ${w}`));
  }
  await writeFile(file, parts.join("\n") + "\n", "utf8");
  return file;
}

async function buildEnforcementReport(
  dir: string | undefined,
  stage: "local" | "pre-commit" | "pre-push" | "ci",
  sessionId?: string,
): Promise<EnforcementReport> {
  const root = findProjectRoot(dir);
  const paths = resolveHaivePaths(root);
  const initialized = existsSync(paths.haiveDir);
  const config = initialized ? await loadConfig(paths) : {};
  if (initialized) {
    await applyLightweightRepairs(root, paths);
    // Atomic release commit: when the repair re-syncs the project-context version
    // header to package.json, stage it so it lands in THIS commit instead of drifting
    // into a later `chore: haive sync [skip ci]` tip — which would skip CI for the whole
    // push (decision 2026-06-02-decision-atomic-release-commit-and-skip-ci-tip).
    if (stage === "pre-commit") await stageResyncedArtifacts(root, paths);
  }
  const mode = config.enforcement?.mode ?? "strict";
  const findings: EnforcementFinding[] = [];

  if (!initialized) {
    return withCategories({
      root,
      initialized,
      mode,
      score: buildScore([], config.enforcement?.scoreThreshold),
      should_block: true,
      findings: [{
        severity: "error",
        code: "not-initialized",
        message: "This repository is not initialized with hAIve.",
        fix: "Run `haive init` or `haive enforce install`.",
        impact: 100,
      }],
    });
  }

  if (mode === "off") {
    return withCategories({
      root,
      initialized,
      mode,
      score: buildScore([], config.enforcement?.scoreThreshold),
      should_block: false,
      findings: [{ severity: "info", code: "enforcement-off", message: "hAIve enforcement is disabled." }],
    });
  }

  findings.push(...await inspectIntegrationVersions(root, __HAIVE_VERSION__));

  if (config.enforcement?.requireBriefingFirst !== false && stage !== "ci") {
    const hasBriefing = await hasRecentBriefingMarker(paths, sessionId);
    findings.push(hasBriefing
      ? { severity: "ok", code: "briefing-loaded", message: "A recent hAIve briefing marker exists." }
      : {
          severity: "error",
          code: "briefing-missing",
          message: "No recent hAIve briefing marker was found for this workflow.",
          fix: "Run `haive briefing --task \"...\"`, `haive enforce session-start`, or wrap the agent with `haive run -- <agent>`.",
          impact: 35,
        });
  }

  if (config.enforcement?.requireSessionRecap !== false && (stage === "pre-push" || stage === "ci")) {
    const hasRecap = await hasRecentSessionRecap(paths);
    findings.push(hasRecap
      ? { severity: "ok", code: "session-recap-present", message: "A recent session_recap memory exists." }
      : stage === "ci"
        ? {
            severity: "warn",
            code: "session-recap-missing",
            message: "No recent session_recap memory was found. CI reports this as a warning because personal recaps are usually not committed.",
            fix: "Run `haive session end --scope team --goal ... --accomplished ...` if you want a team recap visible in CI.",
            impact: 5,
          }
        : {
            severity: "error",
            code: "session-recap-missing",
            message: "No recent session_recap memory was found.",
            fix: "Run `haive session end --goal ... --accomplished ...` before pushing.",
            impact: 20,
          });
  }

  if (config.enforcement?.requireMemoryVerify !== false) {
    findings.push(...await verifyMemoryPolicy(paths, config));
  }

  if (config.enforcement?.requireDecisionCoverage !== false) {
    findings.push(...await verifyDecisionCoverage(paths, stage, sessionId));
  }

  if (stage === "pre-commit" || stage === "ci") {
    findings.push(...await runPrecommitPolicy(paths, config.enforcement?.antiPatternGate ?? "anchored", stage));
  }

  if (config.enforcement?.cleanupGeneratedArtifacts !== false) {
    findings.push(...await findGeneratedArtifacts(paths));
  }

  const score = buildScore(findings, config.enforcement?.scoreThreshold);
  if (score.score < score.threshold) {
    findings.push({
      severity: "error",
      code: "enforcement-score-below-threshold",
      message: `Enforcement score ${score.score}% is below required threshold ${score.threshold}%.`,
      fix: "Load the relevant briefing, address policy findings, then rerun `haive enforce check`.",
      impact: 0,
    });
  }

  const hasErrors = findings.some((f) => f.severity === "error");
  return withCategories({
    root,
    initialized,
    mode,
    score: buildScore(findings, config.enforcement?.scoreThreshold),
    should_block: mode === "strict" && hasErrors,
    findings,
  });
}

function withCategories(report: Omit<EnforcementReport, "categories">): EnforcementReport {
  return {
    ...report,
    categories: {
      blocking: report.findings.filter((f) => f.severity === "error"),
      review: report.findings.filter((f) => f.severity === "warn"),
      info: report.findings.filter((f) => f.severity === "info" || f.severity === "ok"),
    },
  };
}

async function hasRecentSessionRecap(paths: ReturnType<typeof resolveHaivePaths>): Promise<boolean> {
  if (!existsSync(paths.memoriesDir)) return false;
  const all = await loadMemoriesFromDir(paths.memoriesDir);
  return all.some(({ memory }) => {
    const fm = memory.frontmatter;
    const freshnessDate = fm.verified_at ?? fm.created_at;
    return fm.type === "session_recap" &&
      fm.status !== "rejected" &&
      isFreshIsoDate(freshnessDate, SESSION_RECAP_TTL_MS);
  });
}

async function verifyMemoryPolicy(
  paths: ReturnType<typeof resolveHaivePaths>,
  config: HaiveConfig,
): Promise<EnforcementFinding[]> {
  if (!existsSync(paths.memoriesDir)) return [];
  const all = await loadMemoriesFromDir(paths.memoriesDir);
  const findings: EnforcementFinding[] = [];
  const staleImportant: string[] = [];
  let verified = 0;

  for (const { memory } of all) {
    const fm = memory.frontmatter;
    const anchored = fm.anchor.paths.length > 0 || fm.anchor.symbols.length > 0;
    if (!anchored || fm.status === "rejected" || fm.status === "deprecated") continue;
    verified++;
    if (fm.status === "stale") {
      if (["decision", "gotcha", "architecture", "convention"].includes(fm.type)) {
        staleImportant.push(fm.id);
      }
      continue;
    }
    if (config.enforcement?.blockStaleDecisionChanges !== false && ["decision", "gotcha"].includes(fm.type)) {
      const result = await verifyAnchor(memory, { projectRoot: paths.root });
      if (result.stale) staleImportant.push(fm.id);
    }
  }

  findings.push({
    severity: "ok",
    code: "memory-verify-ran",
    message: `Checked ${verified} anchored memories for stale enforcement policy.`,
  });

  if (staleImportant.length > 0) {
    findings.push({
      severity: "error",
      code: "stale-important-memories",
      message: `${staleImportant.length} important anchored memories are stale: ${staleImportant.slice(0, 8).join(", ")}`,
      fix: "Run `haive memory verify --update`, then update or delete stale decisions/gotchas before merging.",
      impact: 40,
    });
  }
  return findings;
}

async function verifyDecisionCoverage(
  paths: ReturnType<typeof resolveHaivePaths>,
  stage: "local" | "pre-commit" | "pre-push" | "ci",
  sessionId?: string,
): Promise<EnforcementFinding[]> {
  if (!existsSync(paths.memoriesDir)) return [];
  // Exclude hAIve-generated artifacts: the agent doesn't author them, so requiring decision
  // coverage for them is pure friction (and blocked release commits over repair-touched files).
  const changedFiles = (await getChangedFiles(paths.root, stage)).filter((f) => !isGeneratedArtifact(f));
  if (changedFiles.length === 0) {
    return [{ severity: "info", code: "decision-coverage-no-changes", message: "No changed files to match against policy memories." }];
  }

  const all = await loadMemoriesFromDir(paths.memoriesDir);
  const policyTypes = new Set(["decision", "gotcha", "architecture", "convention"]);
  const relevant = all
    .map(({ memory }) => memory)
    .filter((memory) => {
      const fm = memory.frontmatter;
      if (!policyTypes.has(fm.type)) return false;
      if (fm.status !== "validated") return false;
      return memoryMatchesAnchorPaths(memory, changedFiles);
    });

  if (relevant.length === 0) {
    return [{
      severity: "ok",
      code: "decision-coverage-none-required",
      message: `No anchored decisions or policies matched ${changedFiles.length} changed file(s).`,
    }];
  }

  const marker = await readRecentBriefingMarker(paths, sessionId);
  if (stage === "ci" && !marker) {
    return [{
      severity: "ok",
      code: "decision-coverage-ci-pass",
      message:
        `CI surfaced ${relevant.length} relevant anchored decision/polic${relevant.length === 1 ? "y" : "ies"} ` +
        `for ${changedFiles.length} changed file(s). Runtime briefing markers are local-only and are not expected on GitHub Actions.`,
      memory_ids: relevant.slice(0, 20).map((memory) => memory.frontmatter.id),
      affected_files: changedFiles.slice(0, 10),
    }];
  }

  const consulted = new Set(marker?.memory_ids ?? []);
  const missing = relevant.filter((memory) => !consulted.has(memory.frontmatter.id));
  if (missing.length === 0) {
    return [{
      severity: "ok",
      code: "decision-coverage-pass",
      message: `Relevant decisions/policies were surfaced for ${changedFiles.length} changed file(s): ${relevant.length}/${relevant.length}.`,
    }];
  }

  return [{
    severity: stage === "local" ? "warn" : "error",
    code: "decision-coverage-missing",
    message: `${missing.length}/${relevant.length} relevant anchored decisions/policies were not present in the latest briefing: ${missing.slice(0, 6).map((m) => m.frontmatter.id).join(", ")}`,
    fix: `Run \`haive briefing --files "${changedFiles.slice(0, 12).join(",")}" --max-memories 60 --task "..."\` before committing (briefings now accumulate, so several smaller briefings also work).`,
    reason: "Changed files overlap validated anchored policy memories that were not recorded in the latest briefing marker.",
    affected_files: changedFiles.slice(0, 10),
    memory_ids: missing.slice(0, 10).map((m) => m.frontmatter.id),
    impact: Math.min(35, 10 + missing.length * 5),
  }];
}

async function runPrecommitPolicy(
  paths: ReturnType<typeof resolveHaivePaths>,
  gate: AntiPatternGate,
  stage: "pre-commit" | "ci",
): Promise<EnforcementFinding[]> {
  if (gate === "off") {
    return [{ severity: "info", code: "precommit-policy-off", message: "Anti-pattern gate is disabled (enforcement.antiPatternGate=off)." }];
  }
  const snapshot = await getPolicyDiffSnapshot(paths.root, stage);
  const touchedPaths = snapshot.paths;
  if (touchedPaths.length === 0) {
    const code = stage === "ci" ? "no-ci-diff-changes" : "no-staged-changes";
    const message = stage === "ci"
      ? "No changed files found for CI policy diff."
      : "No staged changes found for pre-commit policy.";
    return [{ severity: "info", code, message }];
  }
  // The gate→params mapping lives in @hiveai/core so the git-hook path and the
  // standalone `haive precommit` command can never drift apart.
  const { block_on, anchored_blocks } = antiPatternGateParams(gate);
  const result = await preCommitCheck({
    diff: snapshot.diff,
    paths: touchedPaths,
    block_on,
    anchored_blocks,
    semantic: true,
  }, { paths });

  // Deterministic regex sensors — the precise/computational layer. Previously these
  // only ran via the standalone `haive sensors check` and never on a real commit
  // (see 2026-06-03-gotcha-regex-sensors-orphaned-from-precommit-gate). Run them here
  // so a promoted block sensor actually blocks and warn sensors surface in the gate,
  // covering convention/architecture sensors the fuzzy anti-pattern matcher skips.
  const sensorFindings = await runSensorGate(paths, snapshot.diff);

  if (!result.should_block) {
    return [
      {
        severity: "ok",
        code: "precommit-policy-pass",
        message: `${stage === "ci" ? "CI" : "Pre-commit"} policy passed for ${touchedPaths.length} changed file(s).`,
      },
      ...sensorFindings,
    ];
  }
  return [
    {
      severity: "error",
      code: "precommit-policy-block",
      message: `Pre-commit policy matched ${result.summary.blocking_warnings ?? result.summary.anti_patterns} blocking anti-pattern(s), ${result.summary.stale_anchors} stale anchor(s).`,
      fix: "Review the hAIve warnings, then update the code or the relevant memories.",
      impact: 45,
    },
    ...sensorFindings,
  ];
}

/**
 * Files hAIve itself owns/generates — scanning them with sensors self-matches the very
 * memories they mirror (a memory body documenting a bad pattern contains that pattern).
 * Mirrors `isHaiveOwnedPath` in the MCP anti-pattern check, kept local to avoid a new export.
 */
const SENSOR_OWNED_FILES = new Set<string>([
  ...Object.values(BRIDGE_TARGET_PATH),
  "CLAUDE.md",
  ".cursorrules",
  ".gitignore",
  ".mcp.json",
  ".cursor/mcp.json",
  ".vscode/mcp.json",
  ".cursor/rules/haive-mcp-required.mdc",
]);

function isSensorScannablePath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith(".ai/")) return false;
  return !SENSOR_OWNED_FILES.has(p);
}

/**
 * Run the repo's regex sensors against the staged diff and turn hits into findings:
 * a `block`-severity sensor → error (fails the gate); a `warn` sensor → warn (visible,
 * non-blocking). Read-only and best-effort: a sensor bug must never break a commit.
 */
async function runSensorGate(
  paths: ReturnType<typeof resolveHaivePaths>,
  diff: string,
): Promise<EnforcementFinding[]> {
  if (!diff || !existsSync(paths.memoriesDir)) return [];
  try {
    const loaded = await loadMemoriesFromDir(paths.memoriesDir);
    const sensorMemories = loaded
      .map((l) => l.memory)
      .filter((m) => {
        const s = m.frontmatter.sensor;
        return Boolean(s) && s!.kind === "regex" && !isRetiredMemory(m.frontmatter, m.body);
      });
    if (sensorMemories.length === 0) return [];

    // Only scan real code targets — never hAIve-owned/`.ai/` files (self-match guard).
    const targets = sensorTargetsFromDiff(diff).filter((t) => isSensorScannablePath(t.path));
    if (targets.length === 0) return [];

    const hits = runSensors(sensorMemories, targets);
    const findings: EnforcementFinding[] = [];
    const seen = new Set<string>();
    for (const hit of hits) {
      if (seen.has(hit.memory_id)) continue;
      seen.add(hit.memory_id);
      const where = hit.file ? ` (${hit.file})` : "";
      if (hit.severity === "block") {
        findings.push({
          severity: "error",
          code: "sensor-block",
          message: `Block sensor fired — ${hit.memory_id}: ${hit.message}${where}`,
          fix: "Remove the flagged pattern, or run `haive sensors check` to inspect the match.",
          impact: 45,
        });
      } else {
        findings.push({
          severity: "warn",
          code: "sensor-warn",
          message: `Sensor flagged ${hit.memory_id}: ${hit.message}${where}`,
          fix: "Review the flagged line; `haive sensors check` shows the matched code.",
          impact: 5,
        });
      }
    }
    return findings;
  } catch {
    return []; // best-effort: never break the gate on a sensor error
  }
}

async function findGeneratedArtifacts(paths: ReturnType<typeof resolveHaivePaths>): Promise<EnforcementFinding[]> {
  const dirty = await runCommand("git", ["status", "--short", "--untracked-files=all"], paths.root).catch(() => "");
  const generated = dirty
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      isGeneratedArtifactStatusLine(line) ||
      line.includes("__pycache__/") ||
      line.endsWith(".pyc"),
    );
  if (generated.length === 0) {
    return [{ severity: "ok", code: "generated-artifacts-clean", message: "No generated runtime/cache artifacts are visible to git." }];
  }
  return [{
    severity: "warn",
    code: "generated-artifacts-visible",
    message: `${generated.length} generated artifact(s) are visible in git status.`,
    fix: "Run `haive enforce cleanup`, update .gitignore, or remove test/runtime outputs before committing.",
    impact: 10,
  }];
}

function isGeneratedArtifactStatusLine(line: string): boolean {
  const file = line.replace(/^[ MADRCU?!]{1,2}\s+/, "").trim();
  if (file === ".ai/.cache/.gitignore") return false;
  if (file === ".ai/.runtime/.gitignore" || file === ".ai/.runtime/README.md") return false;
  if (file.startsWith(".ai/.runtime/enforcement/briefings/")) return false;
  return file.startsWith(".ai/.cache/") || file.startsWith(".ai/.runtime/");
}

async function cleanupRuntimeDir(runtimeDir: string): Promise<number> {
  let removed = 0;
  await mkdir(runtimeDir, { recursive: true });
  const entries = await readdir(runtimeDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".gitignore" || entry.name === "README.md") continue;
    if (entry.name === "enforcement") {
      removed += await cleanupEnforcementDir(path.join(runtimeDir, entry.name));
      continue;
    }
    await rm(path.join(runtimeDir, entry.name), { recursive: true, force: true });
    removed++;
  }
  await writeFile(path.join(runtimeDir, ".gitignore"), "*\n!.gitignore\n!README.md\n", "utf8");
  if (!existsSync(path.join(runtimeDir, "README.md"))) {
    await writeFile(
      path.join(runtimeDir, "README.md"),
      "# .ai/.runtime — disposable local layer\n\nRuntime data is local. hAIve cleanup preserves briefing markers so enforcement state remains valid.\n",
      "utf8",
    );
  }
  return removed;
}

async function cleanupCacheDir(cacheDir: string): Promise<number> {
  let removed = 0;
  await mkdir(cacheDir, { recursive: true });
  const entries = await readdir(cacheDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".gitignore") continue;
    await rm(path.join(cacheDir, entry.name), { recursive: true, force: true });
    removed++;
  }
  await writeFile(path.join(cacheDir, ".gitignore"), "*\n!.gitignore\n", "utf8");
  return removed;
}

async function cleanupEnforcementDir(enforcementDir: string): Promise<number> {
  let removed = 0;
  const entries = await readdir(enforcementDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === "briefings") continue;
    await rm(path.join(enforcementDir, entry.name), { recursive: true, force: true });
    removed++;
  }
  return removed;
}

async function inspectIntegrationVersions(
  root: string,
  expectedVersion: string,
): Promise<EnforcementFinding[]> {
  const files = [
    ".git/hooks/pre-commit",
    ".git/hooks/pre-push",
    ".claude/settings.local.json",
    ".mcp.json",
    ".cursor/mcp.json",
    ".vscode/mcp.json",
  ];
  const findings: EnforcementFinding[] = [];
  for (const rel of files) {
    const file = path.join(root, rel);
    if (!existsSync(file)) continue;
    const text = await readFile(file, "utf8").catch(() => "");
    for (const bin of extractAbsoluteHaiveBins(text)) {
      const version = versionForBinary(bin);
      if (!version) {
        findings.push({
          severity: "warn",
          code: "integration-haive-binary-missing",
          message: `${rel} references ${bin}, but that binary could not be executed.`,
          fix: "Run `haive agent setup --no-global` or `haive enforce install` to refresh project integrations.",
          impact: 0,
        });
      } else if (version !== expectedVersion) {
        findings.push({
          severity: "warn",
          code: "integration-haive-version-mismatch",
          message: `${rel} references hAIve ${version} at ${bin}; current hAIve is ${expectedVersion}.`,
          fix: "Run `haive agent setup --no-global` and `haive enforce install` to repair stale hooks/configs.",
          impact: 0,
        });
      }
    }
  }
  if (findings.length === 0) {
    return [{
      severity: "ok",
      code: "integration-version-check",
      message: "No stale absolute hAIve binary paths were found in project hooks/MCP configs.",
    }];
  }
  return findings;
}

function extractAbsoluteHaiveBins(text: string): string[] {
  const out = new Set<string>();
  const re = /(["'\s])((?:\/[^"'\s]+)*\/haive)\b/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const p = match[2];
    if (!p) continue;
    // Skip directories — a haive binary is a file, not a folder.
    // Prevents HAIVE_PROJECT_ROOT env values from being mistaken for binaries.
    try {
      if (statSync(p).isDirectory()) continue;
    } catch {
      // Path does not exist — still report as missing binary
    }
    out.add(p);
  }
  return [...out].sort();
}

function versionForBinary(bin: string): string | null {
  try {
    const out = execFileSync(bin, ["--version"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
  } catch {
    return null;
  }
}

async function getChangedFiles(
  root: string,
  stage: "local" | "pre-commit" | "pre-push" | "ci",
): Promise<string[]> {
  if (stage === "ci") {
    return (await getPolicyDiffSnapshot(root, "ci")).paths;
  }
  if (stage === "pre-commit") {
    return normalizeChangedFileList(
      await runCommand("git", ["diff", "--cached", "--name-only"], root).catch(() => ""),
    );
  }
  const files = new Set<string>();
  for (const args of [["diff", "--cached", "--name-only"], ["diff", "--name-only"]]) {
    for (const file of normalizeChangedFileList(await runCommand("git", args, root).catch(() => ""))) {
      files.add(file);
    }
  }
  return [...files];
}

interface PolicyDiffSnapshot {
  diff: string;
  paths: string[];
  source: string;
}

async function getPolicyDiffSnapshot(
  root: string,
  stage: "pre-commit" | "ci",
): Promise<PolicyDiffSnapshot> {
  if (stage === "pre-commit") {
    const diff = await runCommand("git", ["diff", "--cached"], root).catch(() => "");
    const names = await runCommand("git", ["diff", "--cached", "--name-only"], root).catch(() => "");
    return { diff, paths: normalizeChangedFileList(names), source: "staged" };
  }

  const range = await resolveCiDiffRange(root);
  if (range) {
    const diff = await runCommand("git", ["diff", range], root).catch(() => "");
    const names = await runCommand("git", ["diff", "--name-only", range], root).catch(() => "");
    return { diff, paths: normalizeChangedFileList(names), source: range };
  }

  return { diff: "", paths: [], source: "none" };
}

async function resolveCiDiffRange(root: string): Promise<string | null> {
  const explicitBase = cleanGitSha(process.env.HAIVE_BASE_SHA ?? process.env.HAIVE_BASE_REF);
  const explicitHead = cleanGitSha(process.env.HAIVE_HEAD_SHA ?? process.env.GITHUB_SHA) ?? "HEAD";
  if (explicitBase && await gitCommitExists(root, explicitBase)) {
    return `${explicitBase}...${explicitHead}`;
  }

  const eventRange = await resolveGithubEventRange(root);
  if (eventRange) return eventRange;

  const baseRef = process.env.GITHUB_BASE_REF?.trim();
  if (baseRef) {
    const remoteRef = `origin/${baseRef}`;
    if (await gitCommitExists(root, remoteRef)) return `${remoteRef}...${explicitHead}`;
  }

  if (await gitCommitExists(root, "origin/main")) return `origin/main...${explicitHead}`;
  if (await gitCommitExists(root, "origin/master")) return `origin/master...${explicitHead}`;
  if (await gitCommitExists(root, "HEAD^")) return `HEAD^..${explicitHead}`;
  return null;
}

async function resolveGithubEventRange(root: string): Promise<string | null> {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !existsSync(eventPath)) return null;
  try {
    const event = JSON.parse(await readFile(eventPath, "utf8")) as {
      before?: string;
      after?: string;
      pull_request?: {
        base?: { sha?: string };
        head?: { sha?: string };
      };
    };
    const prBase = cleanGitSha(event.pull_request?.base?.sha);
    const prHead = cleanGitSha(event.pull_request?.head?.sha ?? event.after ?? process.env.GITHUB_SHA) ?? "HEAD";
    if (prBase && await gitCommitExists(root, prBase)) return `${prBase}...${prHead}`;

    const pushBase = cleanGitSha(event.before);
    const pushHead = cleanGitSha(event.after ?? process.env.GITHUB_SHA) ?? "HEAD";
    if (pushBase && await gitCommitExists(root, pushBase)) return `${pushBase}..${pushHead}`;
  } catch {
    return null;
  }
  return null;
}

function cleanGitSha(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed || /^0+$/.test(trimmed)) return null;
  return trimmed;
}

async function gitCommitExists(root: string, ref: string): Promise<boolean> {
  try {
    await runCommand("git", ["rev-parse", "--verify", `${ref}^{commit}`], root);
    return true;
  } catch {
    return false;
  }
}

function normalizeChangedFileList(raw: string): string[] {
  return raw.split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((file) =>
      !file.startsWith(".ai/.runtime/") &&
      !file.startsWith(".ai/.cache/") &&
      !file.startsWith(".ai/.usage/") &&
      file !== ".ai/.usage/tool-usage.jsonl"
    );
}

interface GitSyncStatus {
  available: boolean;
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  dirtyFiles: string[];
  changedSinceUpstream: string[];
  releaseBaseRef?: string;
  releaseChangedFiles?: string[];
}

interface GithubActionsRun {
  conclusion?: string | null;
  databaseId?: number;
  name?: string;
  status?: string;
  workflowName?: string;
}

async function getGitSyncStatus(root: string): Promise<GitSyncStatus> {
  const dirty = (await runCommand("git", ["status", "--short", "--untracked-files=all"], root).catch(() => ""))
    .split("\n")
    .map((line) => statusLineToPath(line.trim()))
    .filter(Boolean)
    .filter((file) => normalizeChangedFileList(file).length > 0);
  const branch = (await runCommand("git", ["branch", "--show-current"], root).catch(() => "")).trim() || undefined;
  const upstream = (await runCommand("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], root).catch(() => "")).trim() || undefined;
  if (!branch && !upstream) {
    const inside = (await runCommand("git", ["rev-parse", "--is-inside-work-tree"], root).catch(() => "")).trim();
    if (inside !== "true") return { available: false, ahead: 0, behind: 0, dirtyFiles: [], changedSinceUpstream: [] };
  }

  let ahead = 0;
  let behind = 0;
  let changedSinceUpstream: string[] = [];
  let releaseBaseRef: string | undefined;
  let releaseChangedFiles: string[] | undefined;
  if (upstream) {
    const counts = (await runCommand("git", ["rev-list", "--left-right", "--count", `${upstream}...HEAD`], root).catch(() => "")).trim();
    const [behindRaw, aheadRaw] = counts.split(/\s+/);
    behind = Number.parseInt(behindRaw ?? "0", 10) || 0;
    ahead = Number.parseInt(aheadRaw ?? "0", 10) || 0;
    changedSinceUpstream = normalizeChangedFileList(
      await runCommand("git", ["diff", "--name-only", `${upstream}...HEAD`], root).catch(() => ""),
    );
    if (changedSinceUpstream.length > 0) {
      releaseBaseRef = upstream;
      releaseChangedFiles = changedSinceUpstream;
    }
  }

  if (!releaseChangedFiles || releaseChangedFiles.length === 0) {
    const hasParent = (await runCommand("git", ["rev-parse", "--verify", "--quiet", "HEAD^"], root).catch(() => "")).trim().length > 0;
    if (hasParent) {
      const changedSinceParent = normalizeChangedFileList(
        await runCommand("git", ["diff", "--name-only", "HEAD^..HEAD"], root).catch(() => ""),
      );
      if (changedSinceParent.length > 0) {
        releaseBaseRef = "HEAD^";
        releaseChangedFiles = changedSinceParent;
      }
    }
  }

  return {
    available: true,
    branch,
    upstream,
    ahead,
    behind,
    dirtyFiles: dirty,
    changedSinceUpstream,
    ...(releaseBaseRef ? { releaseBaseRef } : {}),
    ...(releaseChangedFiles ? { releaseChangedFiles } : {}),
  };
}

function statusLineToPath(line: string): string {
  const body = line.replace(/^[ MADRCU?!]{1,2}\s+/, "").trim();
  const renamed = body.match(/.+ -> (.+)$/);
  return renamed?.[1]?.trim() ?? body;
}

const VERSION_FILES = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/mcp/package.json",
  "packages/embeddings/package.json",
] as const;

const SHIPPABLE_PATH_PREFIXES = [
  "packages/core/src/",
  "packages/cli/src/",
  "packages/mcp/src/",
  "packages/embeddings/src/",
];

function isShippablePath(file: string): boolean {
  return SHIPPABLE_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    VERSION_FILES.includes(file as (typeof VERSION_FILES)[number]);
}

/** Directives that make GitHub Actions skip a whole push (matched on the cleaned message). */
const CI_SKIP_DIRECTIVE = /\[skip ci\]|\[ci skip\]|\[no ci\]|\[skip actions\]|\*\*\*NO_CI\*\*\*|skip-checks: *true/i;

/**
 * commit-msg prevention for the skip-ci footgun: GitHub scans the ENTIRE commit message
 * (subject + body) for a CI-skip directive and then skips CI for the whole push. Blocking such a
 * directive ONLY when the commit also carries shippable code keeps legitimate `.ai/`-only sync
 * commits (which correctly use [skip ci]) working. Comment lines (`#…`, stripped by git) are
 * ignored so merely discussing the directive in a comment never blocks.
 */
async function checkCommitMessageSkipCi(
  root: string,
  msgfile: string,
): Promise<{ block: boolean; message: string }> {
  const file = path.isAbsolute(msgfile) ? msgfile : path.join(root, msgfile);
  const raw = await readFile(file, "utf8").catch(() => "");
  const cleaned = raw
    .split("\n")
    .filter((line) => !line.startsWith("#"))
    .join("\n");
  if (!CI_SKIP_DIRECTIVE.test(cleaned)) return { block: false, message: "" };

  const staged = (await runCommand("git", ["diff", "--cached", "--name-only"], root).catch(() => ""))
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const shippable = staged.filter(isShippablePath);
  if (shippable.length === 0) return { block: false, message: "" };

  return {
    block: true,
    message:
      "This commit message contains a CI-skip directive ([skip ci] / [ci skip] / [no ci]) but the commit changes shippable code:\n" +
      shippable.slice(0, 6).map((f) => `  - ${f}`).join("\n") +
      (shippable.length > 6 ? `\n  …and ${shippable.length - 6} more` : "") +
      "\nGitHub scans the whole commit message and would skip CI for the ENTIRE push — your code would land untested.\n" +
      "Fix: reword the message so it does not contain the literal directive (e.g. write 'skip-ci'), or move the\n" +
      "skip-ci sync into a separate `.ai/`-only commit.",
  };
}

interface ReleaseVersionState {
  lockstep: boolean;
  version?: string;
  baseVersion?: string;
  localVersionsLabel: string;
}

async function inspectReleaseVersionState(root: string, upstream: string): Promise<ReleaseVersionState> {
  const localEntries = await Promise.all(VERSION_FILES.map(async (file) => [file, await readPackageVersion(root, file)] as const));
  const localVersions = new Map(localEntries);
  const unique = new Set([...localVersions.values()].filter(Boolean));
  const version = unique.size === 1 ? [...unique][0] : undefined;
  const localVersionsLabel = VERSION_FILES
    .map((file) => `${file}=${localVersions.get(file) ?? "unreadable"}`)
    .join(", ");

  const baseVersion = await readPackageVersionAtRef(root, upstream, "package.json");
  return {
    lockstep: unique.size === 1 && localVersions.size === VERSION_FILES.length,
    ...(version ? { version } : {}),
    ...(baseVersion ? { baseVersion } : {}),
    localVersionsLabel,
  };
}

async function readPackageVersion(root: string, relPath: string): Promise<string | undefined> {
  try {
    const data = JSON.parse(await readFile(path.join(root, relPath), "utf8")) as { version?: unknown };
    return typeof data.version === "string" ? data.version : undefined;
  } catch {
    return undefined;
  }
}

async function readPackageVersionAtRef(root: string, ref: string, relPath: string): Promise<string | undefined> {
  try {
    const raw = await runCommand("git", ["show", `${ref}:${relPath}`], root);
    const data = JSON.parse(raw) as { version?: unknown };
    return typeof data.version === "string" ? data.version : undefined;
  } catch {
    return undefined;
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function tagPointsAtHead(root: string, tag: string): Promise<boolean> {
  const tags = await runCommand("git", ["tag", "--points-at", "HEAD"], root).catch(() => "");
  return tags.split("\n").map((line) => line.trim()).includes(tag);
}

async function remoteTagExists(root: string, tag: string): Promise<boolean | null> {
  const branch = (await runCommand("git", ["branch", "--show-current"], root).catch(() => "")).trim();
  const branchRemote = branch
    ? (await runCommand("git", ["config", "--get", `branch.${branch}.remote`], root).catch(() => "")).trim()
    : "";
  const hasOrigin = (await runCommand("git", ["config", "--get", "remote.origin.url"], root).catch(() => "")).trim().length > 0;
  const remote = branchRemote || (hasOrigin ? "origin" : "");
  if (!remote) return null;
  try {
    const out = await runCommand("git", ["ls-remote", "--tags", remote, `refs/tags/${tag}`], root);
    return out.trim().length > 0;
  } catch {
    return null;
  }
}

async function verifyGithubActionsForHead(
  root: string,
  status: GitSyncStatus,
): Promise<EnforcementFinding[]> {
  if (!status.upstream) return [];
  if (status.ahead > 0) {
    return [{
      severity: "info",
      code: "github-actions-waiting-for-push",
      message: "GitHub Actions verification waits until HEAD is pushed.",
    }];
  }

  const remote = await githubRemoteForCurrentBranch(root);
  if (!remote) {
    return [{
      severity: "info",
      code: "github-actions-not-applicable",
      message: "No GitHub remote was detected; GitHub Actions pipeline verification was skipped.",
    }];
  }

  const sha = (await runCommand("git", ["rev-parse", "HEAD"], root).catch(() => "")).trim();
  if (!sha) {
    return [{
      severity: "error",
      code: "github-actions-head-unreadable",
      message: "Could not read HEAD SHA for GitHub Actions verification.",
      fix: "Run `git rev-parse HEAD`, then verify GitHub Actions manually before finishing.",
      impact: 30,
    }];
  }

  let runs: GithubActionsRun[];
  try {
    const raw = await runCommand("gh", [
      "run",
      "list",
      "--commit",
      sha,
      "--limit",
      "50",
      "--json",
      "conclusion,databaseId,name,status,workflowName",
    ], root);
    runs = JSON.parse(raw) as GithubActionsRun[];
  } catch {
    return [{
      severity: "error",
      code: "github-actions-unverified",
      message: "Could not verify GitHub Actions runs for HEAD.",
      fix: "Install/authenticate GitHub CLI, then run `gh run list --commit $(git rev-parse HEAD)` and ensure every workflow is successful before finishing.",
      reason: `Detected GitHub remote ${remote}, but hAIve could not query workflow runs.`,
      impact: 50,
    }];
  }

  if (runs.length === 0) {
    // Pinpoint the most common cause: GitHub scans the WHOLE HEAD commit message (subject AND
    // body) for a CI-skip directive and then skips the entire push — even when it carries code.
    const headMsg = (await runCommand("git", ["log", "-1", "--pretty=%B"], root).catch(() => "")).trim();
    if (/\[skip ci\]|\[ci skip\]|\[no ci\]|\*\*\*NO_CI\*\*\*|skip-checks: *true/i.test(headMsg)) {
      return [{
        severity: "error",
        code: "github-actions-skipped-by-message",
        message: "No GitHub Actions runs for HEAD because the HEAD commit message contains a CI-skip directive ([skip ci] / [ci skip] / [no ci]) — this skips the WHOLE push, including code.",
        fix: "Reword the HEAD commit so its message (subject AND body) does not contain the literal skip-ci directive — write it as 'skip-ci'. Then re-push, or trigger CI manually with `gh workflow run <workflow.yml> --ref <branch>`.",
        reason: "GitHub scans the entire commit message; a code commit whose message includes a skip-ci directive silently skips CI for the whole push.",
        impact: 60,
      }];
    }
    return [{
      severity: "error",
      code: "github-actions-runs-missing",
      message: "No GitHub Actions runs were found for HEAD.",
      fix: "Wait for GitHub to create the workflow runs, or verify that the push was not skipped by a skip-ci head commit; rerun `haive enforce finish` after the runs appear.",
      impact: 50,
    }];
  }

  const pending = runs.filter((run) => run.status !== "completed");
  if (pending.length > 0) {
    return [{
      severity: "error",
      code: "github-actions-pending",
      message: `${pending.length}/${runs.length} GitHub Actions workflow run(s) for HEAD are still pending: ${formatGithubRunNames(pending)}.`,
      fix: "Wait for the runs to finish (`gh run watch <run-id> --exit-status`), then rerun `haive enforce finish`.",
      impact: 50,
    }];
  }

  const failed = runs.filter((run) => run.conclusion !== "success");
  const failedCore = failed.filter((run) => !isExternalTransientWorkflow(run));
  const failedExternal = failed.filter((run) => isExternalTransientWorkflow(run));

  if (failedCore.length > 0) {
    return [{
      severity: "error",
      code: "github-actions-failed",
      message: `${failedCore.length}/${runs.length} GitHub Actions workflow run(s) for HEAD did not pass: ${formatGithubRunNames(failedCore)}.`,
      fix: "Inspect the failed run logs with `gh run view <run-id> --log`, fix the issue, push the fix, then rerun `haive enforce finish`.",
      impact: 80,
    }];
  }

  if (failedExternal.length > 0) {
    // Don't let a flaky external integration (e.g. SonarQube network/timeout) masquerade as a
    // product regression. hAIve's principle is zero hard dependency on the user's environment, so
    // external workflows are advisory: surfaced as info, never blocking `finish`.
    return [{
      severity: "info",
      code: "github-actions-external-transient",
      message: `${failedExternal.length} external/transient workflow run(s) for HEAD did not pass (non-blocking): ${formatGithubRunNames(failedExternal)}. All core workflows passed.`,
      fix: "External integrations can fail on transient network/timeout. Re-run with `gh run rerun <run-id>` if you want them green — not required to finish.",
    }];
  }

  return [{
    severity: "ok",
    code: "github-actions-pass",
    message: `All ${runs.length} GitHub Actions workflow run(s) for HEAD completed successfully.`,
  }];
}

/** External integrations whose failures are advisory (flaky network/timeout), not product
 *  regressions. Matched by workflow name so it works regardless of file naming. */
function isExternalTransientWorkflow(run: GithubActionsRun): boolean {
  const label = `${run.workflowName ?? ""} ${run.name ?? ""}`.toLowerCase();
  return /\bsonar(qube|cloud)?\b|\bcodeql\b|\bsnyk\b|\bcodecov\b/.test(label);
}

async function githubRemoteForCurrentBranch(root: string): Promise<string | null> {
  const branch = (await runCommand("git", ["branch", "--show-current"], root).catch(() => "")).trim();
  const branchRemote = branch
    ? (await runCommand("git", ["config", "--get", `branch.${branch}.remote`], root).catch(() => "")).trim()
    : "";
  const remoteName = branchRemote || "origin";
  const remoteUrl = (await runCommand("git", ["config", "--get", `remote.${remoteName}.url`], root).catch(() => "")).trim();
  if (!isGithubRemoteUrl(remoteUrl)) return null;
  return remoteUrl;
}

function isGithubRemoteUrl(url: string): boolean {
  return /(^git@github\.com:|github\.com[/:])/.test(url);
}

function formatGithubRunNames(runs: GithubActionsRun[]): string {
  return runs
    .slice(0, 6)
    .map((run) => {
      const label = run.workflowName ?? run.name ?? "workflow";
      return run.databaseId ? `${label}#${run.databaseId}` : label;
    })
    .join(", ");
}

function buildScore(findings: EnforcementFinding[], threshold = 80): EnforcementScore {
  const checks = {
    total: findings.length,
    ok: findings.filter((f) => f.severity === "ok").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    error: findings.filter((f) => f.severity === "error").length,
  };
  const penalty = findings.reduce((sum, f) => {
    if (f.severity === "error") return sum + (f.impact ?? 25);
    if (f.severity === "warn") return sum + (f.impact ?? 8);
    return sum;
  }, 0);
  return {
    score: Math.max(0, Math.min(100, 100 - penalty)),
    threshold,
    checks,
  };
}

async function installGitEnforcement(root: string): Promise<void> {
  const hooksDir = path.join(root, ".git", "hooks");
  if (!existsSync(path.join(root, ".git"))) {
    ui.warn("No .git directory found; git enforcement hooks skipped.");
    return;
  }
  await mkdir(hooksDir, { recursive: true });
  const hooks = [
    {
      name: "pre-commit",
      body: `#!/bin/sh
${ENFORCE_HOOK_MARKER}
haive enforce check --stage pre-commit --dir . || exit $?
`,
    },
    {
      name: "pre-push",
      body: `#!/bin/sh
${ENFORCE_HOOK_MARKER}
haive enforce check --stage pre-push --dir . || exit $?
`,
    },
    {
      name: "commit-msg",
      body: `#!/bin/sh
${ENFORCE_HOOK_MARKER}
haive enforce commit-msg "$1" --dir . || exit $?
`,
    },
  ];
  for (const hook of hooks) {
    const file = path.join(hooksDir, hook.name);
    if (existsSync(file)) {
      const current = await readFile(file, "utf8").catch(() => "");
      if (current.includes(ENFORCE_HOOK_MARKER)) {
        await writeFile(file, hook.body, "utf8");
      } else {
        await writeFile(file, `${current.trimEnd()}\n\n${hook.body}`, "utf8");
      }
    } else {
      await writeFile(file, hook.body, "utf8");
    }
    await chmod(file, 0o755);
  }
  ui.success("Installed blocking git enforcement hooks: pre-commit, pre-push, commit-msg");
}

async function installCiEnforcement(root: string): Promise<void> {
  const workflowPath = path.join(root, ".github", "workflows", "haive-enforcement.yml");
  await mkdir(path.dirname(workflowPath), { recursive: true });
  if (existsSync(workflowPath)) {
    ui.info("GitHub Actions enforcement workflow already exists — skipped");
    return;
  }
  await writeFile(workflowPath, `name: haive-enforcement

on:
  pull_request:
  push:
    branches: [main, master]

jobs:
  haive-enforcement:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install hAIve
        run: npm install -g @hiveai/cli
      - name: Enforce hAIve policy
        env:
          HAIVE_BASE_SHA: \${{ github.event.pull_request.base.sha || github.event.before }}
          HAIVE_HEAD_SHA: \${{ github.event.pull_request.head.sha || github.sha }}
        run: haive enforce ci
`, "utf8");
  ui.success(`Created ${path.relative(root, workflowPath)}`);
}

function printReport(report: EnforcementReport, json: boolean, explain = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(ui.bold(`hAIve enforcement — ${report.mode}`));
  console.log(ui.dim(`  root: ${report.root}`));
  console.log(ui.dim(`  score: ${report.score.score}% / threshold ${report.score.threshold}%`));

  if (explain) {
    printFindingGroup("Blocking", report.categories.blocking, "error");
    printFindingGroup("Review", report.categories.review, "warn");
    printFindingGroup("Info", report.categories.info, "info");
  } else {
    for (const finding of report.findings) printFinding(finding);
  }
  if (report.should_block) ui.error("hAIve enforcement gate failed.");
  else ui.success("hAIve enforcement gate passed.");
}

function printFindingGroup(
  title: string,
  findings: EnforcementFinding[],
  tone: "error" | "warn" | "info",
): void {
  if (findings.length === 0) return;
  console.log();
  const heading = tone === "error" ? ui.red(title) : tone === "warn" ? ui.yellow(title) : ui.bold(title);
  console.log(ui.bold(`${heading} (${findings.length})`));
  const scoreFinding = findings.find((f) => f.code === "enforcement-score-below-threshold");
  for (const finding of findings.filter((f) => f.code !== "enforcement-score-below-threshold")) {
    printFinding(finding, true);
  }
  if (scoreFinding) printFinding(scoreFinding, true);
}

function printFinding(finding: EnforcementFinding, explain = false): void {
    const marker = finding.severity === "error"
      ? ui.red("✗")
      : finding.severity === "warn"
        ? ui.yellow("⚠")
        : finding.severity === "ok"
          ? ui.green("✓")
          : ui.dim("•");
    console.log(`${marker} ${finding.code}: ${finding.message}`);
    if (explain && finding.reason) console.log(ui.dim(`  why: ${finding.reason}`));
    if (explain && finding.affected_files?.length) console.log(ui.dim(`  files: ${finding.affected_files.join(", ")}`));
    if (explain && finding.memory_ids?.length) console.log(ui.dim(`  memories: ${finding.memory_ids.join(", ")}`));
    if (finding.fix) console.log(ui.dim(`${explain ? "  repair: " : "  fix: "}${finding.fix}`));
}

/**
 * Turn the blocking report into one guided next step. Findings are produced in protocol order
 * (worktree clean → synced → version bumped → tag → push → CI), so the first blocking finding
 * with a fix IS the next required action. Surfacing it removes the "assemble the steps yourself"
 * burden that makes the exit protocol error-prone.
 */
function printNextRequiredAction(report: EnforcementReport): void {
  const blocker = report.findings.find((f) => f.severity === "error" && f.fix);
  if (!blocker) return;
  console.log("");
  console.log(ui.bold("→ NEXT REQUIRED ACTION") + ui.dim(`  (${blocker.code})`));
  for (const line of blocker.fix!.split("\n")) console.log(`  ${line}`);
}

async function applyLightweightRepairs(
  root: string,
  paths: ReturnType<typeof resolveHaivePaths>,
): Promise<void> {
  await applyAutopilotRepairs(root, paths, {
    applyConfig: false,
    applyContext: true,
    applyCorpus: true,
    applyCodeMap: false,
    applyCodeSearch: true,
  }).catch(() => { /* lightweight repair is best-effort */ });
}

async function readHookPayload(): Promise<HookPayload> {
  const raw = await readStdin(MAX_STDIN_BYTES);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as HookPayload;
  } catch {
    return {};
  }
}

function resolveRoot(dir: string | undefined, payload: HookPayload): string | null {
  try {
    return findProjectRoot(dir ?? payload.cwd);
  } catch {
    return null;
  }
}

function isWriteLikeTool(payload: HookPayload): boolean {
  const tool = payload.tool_name ?? "";
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) return true;
  if (tool !== "Bash") return false;
  const command = String(payload.tool_input?.["command"] ?? "");
  return /\b(rm|mv|cp|mkdir|touch|tee|sed|perl|python|node|npm|pnpm|yarn|git)\b/.test(command) ||
    />{1,2}/.test(command);
}

function extractToolPaths(payload: HookPayload, root: string): string[] {
  const input = payload.tool_input ?? {};
  const values: unknown[] = [
    input["file_path"],
    input["path"],
    input["notebook_path"],
  ];
  if (Array.isArray(input["file_paths"])) values.push(...input["file_paths"]);
  if (Array.isArray(input["files"])) values.push(...input["files"]);

  if (payload.tool_name === "MultiEdit" && Array.isArray(input["edits"])) {
    for (const edit of input["edits"]) {
      if (edit && typeof edit === "object" && "file_path" in edit) {
        values.push((edit as { file_path?: unknown }).file_path);
      }
    }
  }

  const out = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    out.add(normalizeToolPath(value, root));
  }
  return [...out].filter(Boolean).sort();
}

function normalizeToolPath(file: string, root: string): string {
  const normalized = file.replace(/\\/g, "/");
  if (!path.isAbsolute(normalized)) return normalized.replace(/^\.\//, "");
  return path.relative(root, normalized).replace(/\\/g, "/");
}

async function missingRequiredMemoriesForFiles(
  paths: ReturnType<typeof resolveHaivePaths>,
  files: string[],
  sessionId?: string,
): Promise<LoadedMemory[]> {
  if (!existsSync(paths.memoriesDir)) return [];
  const marker = await readRecentBriefingMarker(paths, sessionId);
  const consulted = new Set(marker?.memory_ids ?? []);
  const policyTypes = new Set(["decision", "gotcha", "architecture", "convention", "attempt"]);
  const all = await loadMemoriesFromDir(paths.memoriesDir);
  return all
    .filter(({ memory }) => {
      const fm = memory.frontmatter;
      if (!policyTypes.has(fm.type)) return false;
      if (fm.status !== "validated") return false;
      if (consulted.has(fm.id)) return false;
      return memoryMatchesAnchorPaths(memory, files);
    })
    .map(({ memory, filePath }) => ({ memory, filePath }));
}

/**
 * hAIve-generated `.ai/` artifacts that the agent never authors — they are re-synced by the
 * lightweight repair (version header, code-map) or are pure telemetry. Requiring a human-reviewed
 * "decision" to cover them is friction with no value, and it caused the gate to block release
 * commits whose only "uncovered" change was a repair-touched artifact. Excluded from
 * decision-coverage's notion of "changed files". Source code and real `.ai/memories/*` still count.
 */
function isGeneratedArtifact(file: string): boolean {
  if (file === ".ai/project-context.md" || file === ".ai/code-map.json") return true;
  if (file.startsWith(".ai/.cache/") || file.startsWith(".ai/.runtime/") || file.startsWith(".ai/.usage/")) return true;
  return false;
}

async function readStdin(maxBytes: number): Promise<string> {
  if (process.stdin.isTTY) return "";
  return await new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    process.stdin.on("data", (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        process.stdin.destroy();
        finish();
        return;
      }
      chunks.push(c);
    });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
    setTimeout(finish, 2000);
  });
}

/**
 * Stage `.ai/` artifacts that a pre-commit lightweight repair just re-synced
 * (currently the project-context version header) so the release commit is atomic.
 * Best-effort — never blocks a commit. Scoped to the project-context file so it does
 * not sweep in telemetry churn (e.g. the tool-usage log) that belongs in a later sync.
 */
/** Machine-local `.ai/` subtrees that must NOT enter the release commit — they belong in a
 *  separate later `chore: haive sync` push (telemetry, runtime markers, derived caches). */
const ATOMIC_STAGE_EXCLUDE = ["/.usage/", "/.runtime/", "/.cache/"];

async function stageResyncedArtifacts(
  root: string,
  paths: ReturnType<typeof resolveHaivePaths>,
): Promise<void> {
  // Stage every tracked `.ai/` file the lightweight repair just re-synced (project-context
  // version header, auto-promoted/re-validated memories, code-map) so the release commit is
  // atomic and the haive-sync workflow has nothing left to commit as a `[skip ci]` tip.
  // `git diff --name-only` lists only tracked files with UNSTAGED changes, relative to the repo
  // root — exactly the repair output. Telemetry subtrees are excluded on purpose.
  const aiRel = path.relative(root, paths.haiveDir);
  const out = await runCommand("git", ["diff", "--name-only", "--", aiRel], root).catch(() => "");
  const toStage = out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => !ATOMIC_STAGE_EXCLUDE.some((excl) => `/${file}`.includes(excl)));
  if (toStage.length === 0) return;
  await runCommand("git", ["add", "--", ...toStage], root).catch(() => { /* best-effort */ });
}

function runCommand(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr || `${cmd} exited with code ${code}`));
    });
  });
}
