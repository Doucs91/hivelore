import { execFile, spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(__dirname, "../dist/index.js");

async function run(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return await exec("node", [CLI, ...args], { cwd });
}

async function runWithInput(
  cwd: string,
  args: string[],
  input: string,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return await new Promise((resolve) => {
    const child = spawn("node", [CLI, ...args], { cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("close", (code) => resolve({ stdout, stderr, code }));
    child.stdin.end(input);
  });
}

describe("hAIve CLI integration", () => {
  let workDir: string;

  beforeAll(async () => {
    if (!existsSync(CLI)) {
      throw new Error(`CLI not built at ${CLI}. Run \`pnpm build\` first.`);
    }
    workDir = await mkdtemp(path.join(tmpdir(), "haive-cli-test-"));
  });

  afterAll(async () => {
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("init creates the .ai/ structure and bridges", async () => {
    await run(workDir, ["init", "--dir", workDir]);
    expect(existsSync(path.join(workDir, ".ai"))).toBe(true);
    expect(existsSync(path.join(workDir, ".ai/project-context.md"))).toBe(true);
    expect(existsSync(path.join(workDir, ".ai/memories/personal"))).toBe(true);
    expect(existsSync(path.join(workDir, ".ai/memories/team"))).toBe(true);
    expect(existsSync(path.join(workDir, ".ai/memories/module"))).toBe(true);
    expect(existsSync(path.join(workDir, ".ai", ".runtime", "README.md"))).toBe(true);
    expect(existsSync(path.join(workDir, "CLAUDE.md"))).toBe(true);
    expect(existsSync(path.join(workDir, ".cursorrules"))).toBe(true);
    expect(existsSync(path.join(workDir, ".github/copilot-instructions.md"))).toBe(true);
    expect(
      existsSync(path.join(workDir, ".cursor/rules/haive-mcp-required.mdc")),
    ).toBe(true);
    const claudeSettings = path.join(workDir, ".claude/settings.local.json");
    expect(existsSync(claudeSettings)).toBe(true);
    const hooks = await readFile(claudeSettings, "utf8");
    expect(hooks).toContain("haive enforce session-start");
    expect(hooks).toContain("haive enforce pre-tool-use");
    expect(existsSync(path.join(workDir, ".github/workflows/haive-enforcement.yml"))).toBe(true);
    const config = JSON.parse(await readFile(path.join(workDir, ".ai/haive.config.json"), "utf8")) as {
      autopilot?: boolean;
      defaultScope?: string;
      defaultStatus?: string;
      autoRepair?: { context?: boolean; corpus?: boolean; codeMap?: boolean; codeSearch?: boolean };
      enforcement?: { mode?: string; requireBriefingFirst?: boolean; requireMemoryVerify?: boolean };
    };
    expect(config.autopilot).toBe(true);
    expect(config.defaultScope).toBe("team");
    expect(config.defaultStatus).toBe("validated");
    expect(config.autoRepair?.context).toBe(true);
    expect(config.autoRepair?.corpus).toBe(true);
    expect(config.autoRepair?.codeMap).toBe(true);
    expect(config.autoRepair?.codeSearch).toBe(true);
    expect(config.enforcement?.mode).toBe("strict");
    expect(config.enforcement?.requireBriefingFirst).toBe(true);
    expect(config.enforcement?.requireMemoryVerify).toBe(true);
  });

  it("init writes project-level MCP configs with HAIVE_PROJECT_ROOT", async () => {
    // These files are written by haive init to fix the multi-project CWD bug.
    const cursorMcp = path.join(workDir, ".cursor", "mcp.json");
    const vscodeMcp = path.join(workDir, ".vscode", "mcp.json");
    const claudeMcp = path.join(workDir, ".mcp.json");

    expect(existsSync(cursorMcp)).toBe(true);
    expect(existsSync(vscodeMcp)).toBe(true);
    expect(existsSync(claudeMcp)).toBe(true);

    const cursorConfig = JSON.parse(await readFile(cursorMcp, "utf8")) as {
      mcpServers: Record<string, { command: string; env?: Record<string, string> }>;
    };
    expect(cursorConfig.mcpServers["haive"]).toBeDefined();
    expect(cursorConfig.mcpServers["haive"]!.command).toBe("haive");
    expect(cursorConfig.mcpServers["haive"]!.args).toEqual(["mcp", "--stdio"]);
    expect(cursorConfig.mcpServers["haive"]!.env?.["HAIVE_PROJECT_ROOT"]).toBe(workDir);
  });

  it("agent status reports the selected hAIve mode", async () => {
    const { stdout } = await run(workDir, ["agent", "status", "--json", "--dir", workDir]);
    const report = JSON.parse(stdout) as {
      initialized: boolean;
      recommended_mode: string;
      project_mcp: Array<{ present: boolean }>;
    };
    expect(report.initialized).toBe(true);
    expect(["mcp", "wrapped", "fallback"]).toContain(report.recommended_mode);
    expect(report.project_mcp.some((item) => item.present)).toBe(true);
  });

  it("agent setup writes project configs and mode metadata without global config", async () => {
    const { stdout } = await run(workDir, ["agent", "setup", "--no-global", "--json", "--dir", workDir]);
    const report = JSON.parse(stdout) as {
      detection: { recommended_mode: string };
      mode_file: string;
      global_skipped_reason?: string;
    };
    expect(["mcp", "wrapped", "fallback"]).toContain(report.detection.recommended_mode);
    expect(report.global_skipped_reason).toContain("disabled");
    expect(existsSync(report.mode_file)).toBe(true);
  });

  it("doctor --json exposes scores and structured sections", async () => {
    const { stdout } = await run(workDir, ["doctor", "--json", "--dir", workDir]);
    const report = JSON.parse(stdout) as {
      scores: { protection_score: number; context_quality_score: number; corpus_quality_score: number };
      sections: Record<string, unknown[]>;
      findings: Array<{ code: string; section: string }>;
    };
    expect(report.scores.protection_score).toEqual(expect.any(Number));
    expect(report.scores.context_quality_score).toEqual(expect.any(Number));
    expect(report.scores.corpus_quality_score).toEqual(expect.any(Number));
    expect(report.sections["Agent coverage"]).toBeDefined();
    expect(report.findings.every((finding) => typeof finding.section === "string")).toBe(true);
  });

  it("default help only shows the core harness surface", async () => {
    const { stdout } = await run(workDir, ["--help"]);
    expect(stdout).toContain("Commands:");
    expect(stdout).toContain("doctor");
    expect(stdout).toContain("briefing");
    expect(stdout).toContain("enforce");
    expect(stdout).toContain("Default help shows the core harness workflow");
    expect(stdout).not.toContain("playback");
    expect(stdout).not.toContain("snapshot");
    expect(stdout).not.toContain("benchmark");
  });

  it("advanced help exposes maintenance and experimental commands", async () => {
    const { stdout } = await run(workDir, ["--advanced", "--help"]);
    expect(stdout).toContain("playback");
    expect(stdout).toContain("snapshot");
    expect(stdout).toContain("benchmark");
  });

  it("default memory help hides corpus maintenance commands", async () => {
    const { stdout } = await run(workDir, ["memory", "--help"]);
    expect(stdout).toContain("add");
    expect(stdout).toContain("tried");
    expect(stdout).toContain("lint");
    expect(stdout).not.toContain("conflict-candidates");
    expect(stdout).not.toContain("import-changelog");
    expect(stdout).not.toContain("auto-promote");
  });

  it("init adds project-level MCP configs to .gitignore", async () => {
    const gitignore = await readFile(path.join(workDir, ".gitignore"), "utf8");
    expect(gitignore).toContain(".cursor/mcp.json");
    expect(gitignore).toContain(".vscode/mcp.json");
    expect(gitignore).toContain(".mcp.json");
  });

  it("memory add uses autopilot defaults by default", async () => {
    await run(workDir, [
      "memory",
      "add",
      "--type", "convention",
      "--slug", "use pnpm",
      "--tags", "tooling,setup",
      "--body", "Always use pnpm in this project.",
      "--dir", workDir,
    ]);
    const teamDir = path.join(workDir, ".ai/memories/team");
    const files = await readdir(teamDir);
    expect(files.length).toBe(1);
    const content = await readFile(path.join(teamDir, files[0]!), "utf8");
    expect(content).toContain("scope: team");
    expect(content).toContain("status: validated");
    expect(content).toContain("Always use pnpm in this project.");
  });

  it("memory list returns the added memory", async () => {
    const { stdout } = await run(workDir, ["memory", "list", "--dir", workDir]);
    expect(stdout).toContain("convention");
    expect(stdout).toContain("use-pnpm");
  });

  it("memory query finds by tag substring", async () => {
    const { stdout } = await run(workDir, ["memory", "query", "tooling", "--dir", workDir]);
    expect(stdout).toContain("use-pnpm");
  });

  it("memory promote moves a memory from personal to team with status=proposed", async () => {
    await run(workDir, [
      "memory",
      "add",
      "--type", "gotcha",
      "--slug", "manual review",
      "--scope", "personal",
      "--body", "Keep this local until promoted.",
      "--dir", workDir,
    ]);

    const personalDir = path.join(workDir, ".ai/memories/personal");
    const beforeFiles = await readdir(personalDir);
    const id = beforeFiles[0]!.replace(/\.md$/, "");

    await run(workDir, ["memory", "promote", id, "--dir", workDir]);

    const afterPersonal = await readdir(personalDir);
    expect(afterPersonal.length).toBe(0);

    const teamDir = path.join(workDir, ".ai/memories/team");
    const teamFiles = await readdir(teamDir);
    const promotedFile = teamFiles.find((file) => file.includes("manual-review"));
    expect(promotedFile).toBeDefined();
    const promoted = await readFile(path.join(teamDir, promotedFile!), "utf8");
    expect(promoted).toContain("scope: team");
    expect(promoted).toContain("status: proposed");
  });

  it("memory show prints metadata and body", async () => {
    const teamDir = path.join(workDir, ".ai/memories/team");
    const teamFiles = await readdir(teamDir);
    const id = teamFiles[0]!.replace(/\.md$/, "");
    const { stdout } = await run(workDir, ["memory", "show", id, "--dir", workDir]);
    expect(stdout).toContain(id);
    expect(stdout).toContain("scope:");
    expect(stdout).toContain("confidence:");
    expect(stdout).toContain("Always use pnpm");
  });

  it("memory lint --fix dry-run reports simple fixes and --apply writes headings", async () => {
    await run(workDir, [
      "memory", "add",
      "--type", "decision",
      "--slug", "lint heading fix",
      "--scope", "team",
      "--body", "Always keep API stable because clients depend on it.",
      "--dir", workDir,
    ]);

    const dry = await run(workDir, ["memory", "lint", "--fix", "--dry-run", "--json", "--dir", workDir]);
    const dryReport = JSON.parse(dry.stdout) as {
      findings: Array<{ id: string; code: string }>;
      fixes: Array<{ id: string; actions: string[]; applied: boolean }>;
    };
    const targetFix = dryReport.fixes.find((f) => f.id.includes("lint-heading-fix"));
    expect(targetFix?.applied).toBe(false);
    expect(targetFix?.actions).toContain("add missing Markdown heading");

    await run(workDir, ["memory", "lint", "--fix", "--apply", "--dir", workDir]);
    const teamFiles = await readdir(path.join(workDir, ".ai/memories/team"));
    const lintFile = teamFiles.find((f) => f.includes("lint-heading-fix"));
    expect(lintFile).toBeDefined();
    const content = await readFile(path.join(workDir, ".ai/memories/team", lintFile!), "utf8");
    expect(content).toContain("# Decision Lint Heading Fix");
  });

  it("memory rm --yes deletes the file and removes the usage entry", async () => {
    await run(workDir, [
      "memory", "add",
      "--type", "gotcha",
      "--slug", "deleteme",
      "--scope", "personal",
      "--body", "x",
      "--dir", workDir,
    ]);
    const personalDir = path.join(workDir, ".ai/memories/personal");
    const filesBefore = await readdir(personalDir);
    expect(filesBefore.length).toBe(1);
    const id = filesBefore[0]!.replace(/\.md$/, "");

    await run(workDir, ["memory", "rm", id, "--yes", "--dir", workDir]);

    const filesAfter = await readdir(personalDir);
    expect(filesAfter.length).toBe(0);
  });

  it("memory rm errors on unknown id", async () => {
    let threw = false;
    try {
      await run(workDir, ["memory", "rm", "nonexistent-id", "--yes", "--dir", workDir]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  it("enforce pre-tool-use blocks writes until session-start creates a briefing marker", async () => {
    const payload = JSON.stringify({
      cwd: workDir,
      session_id: "cli-test-session",
      tool_name: "Write",
      tool_input: { file_path: "src/new.ts" },
    });

    const blocked = await runWithInput(workDir, ["enforce", "pre-tool-use", "--dir", workDir], payload);
    expect(blocked.code).toBe(2);
    expect(blocked.stderr).toContain("hAIve enforcement blocked this action");

    const started = await runWithInput(workDir, ["enforce", "session-start", "--dir", workDir], payload);
    expect(started.code).toBe(0);
    expect(started.stdout).toContain("hAIve briefing loaded");

    const allowed = await runWithInput(workDir, ["enforce", "pre-tool-use", "--dir", workDir], payload);
    expect(allowed.code).toBe(0);
    expect(allowed.stderr).toBe("");
  });

  it("briefing satisfies the agent-agnostic local enforcement gate", async () => {
    await run(workDir, ["briefing", "--task", "local enforcement smoke", "--budget", "quick", "--dir", workDir]);
    const { stdout } = await run(workDir, ["enforce", "check", "--stage", "local", "--json", "--dir", workDir]);
    const report = JSON.parse(stdout) as {
      should_block: boolean;
      score: { score: number; threshold: number };
      findings: Array<{ code: string }>;
    };
    expect(report.should_block).toBe(false);
    expect(report.score.score).toBeGreaterThanOrEqual(report.score.threshold);
    expect(report.findings.some((f) => f.code === "briefing-loaded")).toBe(true);
  });

  it("CI enforcement warns but does not block when only session recap is missing", async () => {
    const { stdout } = await run(workDir, ["enforce", "ci", "--json", "--dir", workDir]);
    const report = JSON.parse(stdout) as {
      should_block: boolean;
      findings: Array<{ code: string; severity: string }>;
    };
    const recap = report.findings.find((f) => f.code === "session-recap-missing");
    expect(report.should_block).toBe(false);
    expect(recap?.severity).toBe("warn");
  });

  it("run wraps arbitrary agent commands with a hAIve session marker", async () => {
    const { stdout } = await run(workDir, ["run", "--dir", workDir, "--", "node", "-e", "console.log(process.env.HAIVE_ENFORCEMENT)"]);
    expect(stdout).toContain("strict");
  });

  it("benchmark report summarizes agent benchmark reports", async () => {
    const benchDir = path.join(workDir, "benchmarks", "agent-benchmark");
    const fixtureDir = path.join(benchDir, "sample-haive");
    await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
      await mkdir(fixtureDir, { recursive: true });
      await writeFile(path.join(fixtureDir, "BENCHMARK_AGENT_REPORT.md"), [
        "# Benchmark Agent Report",
        "",
        "## Commands Run",
        "- `haive briefing`",
        "- `npm test`",
        "",
        "## Files Read",
        "- `src/index.ts`",
        "",
        "## Files Modified",
        "- `src/index.ts`",
        "",
        "## Test Iterations",
        "- Iteration 1: passed",
        "",
        "## Key Decisions Made",
        "- followed policy",
        "",
        "## hAIve Memory Impact",
        "Yes, directly shaped the fix.",
        "",
      ].join("\n"), "utf8");
    });

    const { stdout } = await run(workDir, ["benchmark", "report", "--dir", benchDir]);
    expect(stdout).toContain("hAIve Agent Benchmark Report");
    expect(stdout).toContain("sample-haive");
    expect(stdout).toContain("hAIve impact");
  });
});
