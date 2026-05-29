import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
    message: `Pre-commit policy matched ${result.summary.blocking_warnings ?? result.summary.anti_patterns} blocking anti-pattern(s), ${result.summary.stale_anchors} stale anchor(s).`,
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
    if (match[2]) out.add(match[2]);
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
  return [...files].filter((file) =>
    !file.startsWith(".ai/.runtime/") &&
    !file.startsWith(".ai/.cache/") &&
    !file.startsWith(".ai/.usage/") &&
    file !== ".ai/.usage/tool-usage.jsonl"
  );
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
    if (finding.fix) console.log(ui.dim(`${explain ? "  repair: " : "  fix: "}${finding.fix}`));
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
