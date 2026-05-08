import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  hasRecentBriefingMarker,
  isFreshIsoDate,
  loadConfig,
  loadMemoriesFromDir,
  memoryMatchesAnchorPaths,
  readRecentBriefingMarker,
  resolveBriefingBudget,
  resolveHaivePaths,
  saveConfig,
  SESSION_RECAP_TTL_MS,
  verifyAnchor,
  writeBriefingMarker,
  type HaiveConfig,
} from "@hiveai/core";
import { getBriefing, preCommitCheck } from "@hiveai/mcp";
import { ui } from "../utils/ui.js";
import { installClaudeHooksAtPath, defaultClaudeSettingsPath } from "../utils/claude-hooks.js";

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
}

interface EnforcementFinding {
  severity: "ok" | "info" | "warn" | "error";
  code: string;
  message: string;
  fix?: string;
  impact?: number;
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
    .option("--json", "emit JSON", false)
    .action(async (opts: EnforceOptions) => {
      const report = await buildEnforcementReport(opts.dir, "local");
      printReport(report, Boolean(opts.json));
      if (report.should_block) process.exitCode = 1;
    });

  enforce
    .command("check")
    .description("Run the hAIve policy gate. Intended for pre-commit, pre-push, wrappers, and any agent client.")
    .option("-d, --dir <dir>", "project root")
    .option("--stage <stage>", "local | pre-commit | pre-push | ci", "local")
    .option("--json", "emit JSON", false)
    .action(async (opts: EnforceOptions) => {
      const report = await buildEnforcementReport(opts.dir, opts.stage ?? "local");
      printReport(report, Boolean(opts.json));
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
      const targets = [
        path.join(paths.haiveDir, ".cache"),
        path.join(paths.haiveDir, ".runtime"),
      ];
      for (const target of targets) {
        if (!existsSync(target)) continue;
        const rel = path.relative(root, target);
        if (opts.dryRun) ui.info(`would remove ${rel}`);
        else {
          await rm(target, { recursive: true, force: true });
          ui.success(`removed ${rel}`);
        }
      }
    });

  enforce
    .command("ci")
    .description("CI entrypoint: fail if the repository violates hAIve enforcement policy.")
    .option("-d, --dir <dir>", "project root")
    .option("--json", "emit JSON", false)
    .action(async (opts: EnforceOptions) => {
      const report = await buildEnforcementReport(opts.dir, "ci");
      printReport(report, Boolean(opts.json));
      if (report.should_block) process.exit(2);
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
    .description("Claude Code PreToolUse hook: block writes until hAIve briefing has been loaded.")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: EnforceOptions) => {
      const payload = await readHookPayload();
      const root = resolveRoot(opts.dir, payload);
      if (!root) return;
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) return;
      if (!isWriteLikeTool(payload)) return;

      const ok = await hasRecentBriefingMarker(paths, payload.session_id);
      if (ok) return;

      const tool = payload.tool_name ?? "write tool";
      console.error(
        [
          "hAIve enforcement blocked this action.",
          `Tool: ${tool}`,
          "",
          "This project is initialized with hAIve. Load the team briefing before editing:",
          "  haive enforce session-start",
          "or call MCP get_briefing / mem_relevant_to from your AI client.",
          "",
          "If this is intentional, a human can disable enforcement in .ai/haive.config.json:",
          '  { "enforcement": { "requireBriefingFirst": false } }',
        ].join("\n"),
      );
      process.exit(2);
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
  const mode = config.enforcement?.mode ?? "strict";
  const findings: EnforcementFinding[] = [];

  if (!initialized) {
    return {
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
    };
  }

  if (mode === "off") {
    return {
      root,
      initialized,
      mode,
      score: buildScore([], config.enforcement?.scoreThreshold),
      should_block: false,
      findings: [{ severity: "info", code: "enforcement-off", message: "hAIve enforcement is disabled." }],
    };
  }

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
    findings.push(...await runPrecommitPolicy(paths));
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
  return {
    root,
    initialized,
    mode,
    score: buildScore(findings, config.enforcement?.scoreThreshold),
    should_block: mode === "strict" && hasErrors,
    findings,
  };
}

async function hasRecentSessionRecap(paths: ReturnType<typeof resolveHaivePaths>): Promise<boolean> {
  if (!existsSync(paths.memoriesDir)) return false;
  const all = await loadMemoriesFromDir(paths.memoriesDir);
  return all.some(({ memory }) =>
    memory.frontmatter.type === "session_recap" &&
    memory.frontmatter.status !== "rejected" &&
    isFreshIsoDate(memory.frontmatter.created_at, SESSION_RECAP_TTL_MS),
  );
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
  const changedFiles = await getChangedFiles(paths.root, stage);
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
      if (fm.status === "rejected" || fm.status === "deprecated" || fm.status === "stale") return false;
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
    fix: `Run \`haive briefing --files "${changedFiles.slice(0, 10).join(",")}" --task "..."\` before committing.`,
    impact: Math.min(35, 10 + missing.length * 5),
  }];
}

async function runPrecommitPolicy(paths: ReturnType<typeof resolveHaivePaths>): Promise<EnforcementFinding[]> {
  const staged = await runCommand("git", ["diff", "--cached", "--name-only"], paths.root).catch(() => "");
  const touchedPaths = staged.split("\n").map((s) => s.trim()).filter(Boolean);
  if (touchedPaths.length === 0) {
    return [{ severity: "info", code: "no-staged-changes", message: "No staged changes found for pre-commit policy." }];
  }
  const diff = await runCommand("git", ["diff", "--cached"], paths.root).catch(() => "");
  const result = await preCommitCheck({
    diff,
    paths: touchedPaths,
    block_on: "high-confidence",
    semantic: true,
  }, { paths });
  if (!result.should_block) {
    return [{
      severity: "ok",
      code: "precommit-policy-pass",
      message: `Pre-commit policy passed for ${touchedPaths.length} staged file(s).`,
    }];
  }
  return [{
    severity: "error",
    code: "precommit-policy-block",
    message: `Pre-commit policy matched ${result.summary.anti_patterns} anti-pattern(s), ${result.summary.stale_anchors} stale anchor(s).`,
    fix: "Review the hAIve warnings, then update the code or the relevant memories.",
    impact: 45,
  }];
}

async function findGeneratedArtifacts(paths: ReturnType<typeof resolveHaivePaths>): Promise<EnforcementFinding[]> {
  const dirty = await runCommand("git", ["status", "--short", "--untracked-files=all"], paths.root).catch(() => "");
  const generated = dirty
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      line.includes(".ai/.cache/") ||
      line.includes(".ai/.runtime/") ||
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

async function getChangedFiles(
  root: string,
  stage: "local" | "pre-commit" | "pre-push" | "ci",
): Promise<string[]> {
  const commands =
    stage === "pre-commit"
      ? [["diff", "--cached", "--name-only"]]
      : [
          ["diff", "--cached", "--name-only"],
          ["diff", "--name-only"],
        ];
  const files = new Set<string>();
  for (const args of commands) {
    const out = await runCommand("git", args, root).catch(() => "");
    for (const line of out.split("\n")) {
      const file = line.trim();
      if (file) files.add(file);
    }
  }
  return [...files].filter((file) => !file.startsWith(".ai/.runtime/") && !file.startsWith(".ai/.cache/"));
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
  ui.success("Installed blocking git enforcement hooks: pre-commit, pre-push");
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
        run: haive enforce ci
`, "utf8");
  ui.success(`Created ${path.relative(root, workflowPath)}`);
}

function printReport(report: EnforcementReport, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(ui.bold(`hAIve enforcement — ${report.mode}`));
  console.log(ui.dim(`  root: ${report.root}`));
  console.log(ui.dim(`  score: ${report.score.score}% / threshold ${report.score.threshold}%`));
  for (const finding of report.findings) {
    const marker = finding.severity === "error"
      ? ui.red("✗")
      : finding.severity === "warn"
        ? ui.yellow("⚠")
        : finding.severity === "ok"
          ? ui.green("✓")
          : ui.dim("•");
    console.log(`${marker} ${finding.code}: ${finding.message}`);
    if (finding.fix) console.log(ui.dim(`  fix: ${finding.fix}`));
  }
  if (report.should_block) ui.error("hAIve enforcement gate failed.");
  else ui.success("hAIve enforcement gate passed.");
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
