import { execFile, spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
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

async function runAllowFailure(
  cwd: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return await new Promise((resolve) => {
    const child = spawn("node", [CLI, ...args], {
      cwd,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

async function writeLockstepPackageJsons(root: string, version: string): Promise<void> {
  const packageFiles = [
    "package.json",
    "packages/core/package.json",
    "packages/cli/package.json",
    "packages/mcp/package.json",
    "packages/embeddings/package.json",
  ];
  for (const rel of packageFiles) {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(
      path.join(root, rel),
      JSON.stringify({ name: rel === "package.json" ? "test-root" : rel, version, type: "module" }, null, 2) + "\n",
      "utf8",
    );
  }
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
    expect(existsSync(path.join(workDir, "AGENTS.md"))).toBe(true);
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
    const syncWorkflow = await readFile(path.join(workDir, ".github/workflows/haive-sync.yml"), "utf8");
    expect(syncWorkflow).toContain("Doucs91/hAIve/packages/github-action@v");
    expect(syncWorkflow).not.toContain("Doucs91/hAIve/packages/github-action@main");
    // No-op-safe harness quality regression gate is wired into the generated CI.
    expect(syncWorkflow).toContain("pr-eval-gate");
    expect(syncWorkflow).toContain("haive eval --regression-gate");
    const enforcementWorkflow = await readFile(path.join(workDir, ".github/workflows/haive-enforcement.yml"), "utf8");
    expect(enforcementWorkflow).toContain("HAIVE_BASE_SHA");
    expect(enforcementWorkflow).toContain("HAIVE_HEAD_SHA");
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

  it("init --stack seeds backend packs whose memories carry executable sensors", async () => {
    const stackDir = await mkdtemp(path.join(tmpdir(), "haive-stack-test-"));
    try {
      await run(stackDir, ["init", "--stack", "django,fastapi", "--no-bootstrap", "-y", "--dir", stackDir]);
      const teamDir = path.join(stackDir, ".ai/memories/team");
      const files = (await readdir(teamDir)).filter((f) => f.endsWith(".md"));
      expect(files.some((f) => f.includes("django"))).toBe(true);
      expect(files.some((f) => f.includes("fastapi"))).toBe(true);

      const debugFile = files.find((f) => f.includes("django-debug"));
      expect(debugFile).toBeDefined();
      const body = await readFile(path.join(teamDir, debugFile!), "utf8");
      expect(body).toContain("sensor:");
      expect(body).toContain("DEBUG");
      expect(body).toContain("severity: warn");

      // The seeded sensor must actually fire on a matching diff.
      const diffFile = path.join(stackDir, "bad.diff");
      await writeFile(
        diffFile,
        "diff --git a/settings.py b/settings.py\n--- a/settings.py\n+++ b/settings.py\n@@ -1 +1 @@\n+DEBUG = True\n",
        "utf8",
      );
      const { stdout } = await run(stackDir, ["sensors", "check", "--diff-file", diffFile, "--dir", stackDir]);
      expect(stdout).toContain("hit(s)");
      expect(stdout).toContain("django-debug");
    } finally {
      await rm(stackDir, { recursive: true, force: true });
    }
  });

  it("sync --inject-bridge injects into both CLAUDE.md and AGENTS.md", async () => {
    const bridgeDir = await mkdtemp(path.join(tmpdir(), "haive-bridge-test-"));
    try {
      await run(bridgeDir, ["init", "--no-bootstrap", "--stack", "none", "-y", "--dir", bridgeDir]);
      await run(bridgeDir, [
        "memory", "add", "--type", "convention", "--slug", "bridge-demo",
        "--body", "Always use the bridge demo convention.", "--scope", "team", "--dir", bridgeDir,
      ]);
      await run(bridgeDir, ["sync", "--inject-bridge", "--quiet", "--dir", bridgeDir]);

      const claude = await readFile(path.join(bridgeDir, "CLAUDE.md"), "utf8");
      const agents = await readFile(path.join(bridgeDir, "AGENTS.md"), "utf8");
      expect(claude).toContain("bridge-demo");
      expect(agents).toContain("haive:memories-start");
      expect(agents).toContain("bridge-demo");
    } finally {
      await rm(bridgeDir, { recursive: true, force: true });
    }
  });

  it("eval --baseline then --compare reports a delta", async () => {
    const evalDir = await mkdtemp(path.join(tmpdir(), "haive-eval-test-"));
    try {
      await run(evalDir, ["init", "--no-bootstrap", "--stack", "none", "-y", "--dir", evalDir]);
      // A memory carrying a sensor that fires on a known-bad diff (deterministic, no embeddings).
      const memFile = path.join(evalDir, ".ai/memories/team/2099-01-01-gotcha-evaltest.md");
      await writeFile(
        memFile,
        [
          "---",
          "id: 2099-01-01-gotcha-evaltest",
          "scope: team",
          "type: gotcha",
          "status: validated",
          "created_at: 2099-01-01T00:00:00.000Z",
          "anchor:",
          "  paths: []",
          "  symbols: []",
          "tags: []",
          "sensor:",
          "  kind: regex",
          '  pattern: "EVILPATTERN"',
          '  message: "no evil"',
          "  severity: warn",
          "  autogen: false",
          "  last_fired: null",
          "---",
          "# Evil pattern",
          "Do not use EVILPATTERN.",
        ].join("\n"),
        "utf8",
      );
      const specFile = path.join(evalDir, "spec.json");
      await writeFile(
        specFile,
        JSON.stringify({
          sensors: [
            { name: "evil", diff: "+ const x = EVILPATTERN;", expect_fire_ids: ["2099-01-01-gotcha-evaltest"] },
          ],
        }),
        "utf8",
      );

      const blFile = path.join(evalDir, "bl.json");
      await run(evalDir, ["eval", "--spec", specFile, "--baseline", "--baseline-file", blFile, "--dir", evalDir]);
      expect(existsSync(blFile)).toBe(true);

      const { stdout } = await run(evalDir, ["eval", "--spec", specFile, "--compare", "--baseline-file", blFile, "--dir", evalDir]);
      expect(stdout).toContain("vs baseline");
      expect(stdout).toContain("UNCHANGED");
      expect(stdout).toContain("catch-rate");
    } finally {
      await rm(evalDir, { recursive: true, force: true });
    }
  });

  it("ingest --from sonar-api degrades gracefully when no credentials are configured", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "haive-sonarapi-test-"));
    try {
      await run(d, ["init", "--no-bootstrap", "--stack", "none", "-y", "--dir", d]);
      let out = "";
      try {
        const r = await run(d, ["ingest", "--from", "sonar-api", "--dir", d]);
        out = r.stdout + r.stderr;
      } catch (e) {
        const err = e as { stdout?: string; stderr?: string };
        out = (err.stdout ?? "") + (err.stderr ?? "");
      }
      // Clear, actionable message — never a crash/stack trace; the rest of hAIve is unaffected.
      expect(out).toMatch(/sonar-url|SONAR_HOST_URL/);
      expect(out).not.toMatch(/at Object\.|node:internal/);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
  });

  it("eval --regression-gate is a no-op (exit 0) when no baseline exists", async () => {
    const d = await mkdtemp(path.join(tmpdir(), "haive-gate-test-"));
    try {
      await run(d, ["init", "--no-bootstrap", "--stack", "none", "-y", "--dir", d]);
      const memFile = path.join(d, ".ai/memories/team/2099-01-01-gotcha-gate.md");
      await writeFile(
        memFile,
        [
          "---", "id: 2099-01-01-gotcha-gate", "scope: team", "type: gotcha", "status: validated",
          "created_at: 2099-01-01T00:00:00.000Z", "anchor:", "  paths: []", "  symbols: []", "tags: []",
          "sensor:", "  kind: regex", '  pattern: "GATEPATTERN"', '  message: "no gate"',
          "  severity: warn", "  autogen: false", "  last_fired: null", "---", "# Gate", "Avoid GATEPATTERN.",
        ].join("\n"),
        "utf8",
      );
      const specFile = path.join(d, "spec.json");
      await writeFile(
        specFile,
        JSON.stringify({ sensors: [{ name: "g", diff: "+ GATEPATTERN", expect_fire_ids: ["2099-01-01-gotcha-gate"] }] }),
        "utf8",
      );
      // No baseline written → gate must skip, not fail.
      const r = await run(d, ["eval", "--spec", specFile, "--regression-gate", "--dir", d]);
      expect(r.stdout + r.stderr).toMatch(/regression gate skipped/i);
    } finally {
      await rm(d, { recursive: true, force: true });
    }
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

  it("doctor treats stack-pack seeds as generic guidance, not anchorless repo policy", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-stack-doctor-"));
    try {
      await writeFile(
        path.join(repo, "package.json"),
        JSON.stringify({ dependencies: { next: "latest", react: "latest" } }, null, 2),
        "utf8",
      );
      await run(repo, ["init", "--no-mcp-setup", "--dir", repo]);
      const { stdout } = await run(repo, ["doctor", "--json", "--dir", repo]);
      const report = JSON.parse(stdout) as { findings: Array<{ code: string; severity: string }> };

      expect(report.findings.some((finding) => finding.code === "stack-pack-seeds")).toBe(true);
      expect(report.findings.some((finding) => finding.code === "anchorless-majority")).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
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
    expect(existsSync(path.join(workDir, ".ai/.cache/embeddings/embeddings-index.json"))).toBe(true);
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

  it("memory add --activation writes skill progressive-disclosure triggers", async () => {
    await run(workDir, [
      "memory", "add",
      "--type", "skill",
      "--slug", "deploy-playbook",
      "--activation-keyword", "deploy,release",
      "--activation-glob", "scripts/**",
      "--body", "# Deploy\n\nSteps to deploy this service.",
      "--dir", workDir,
    ]);
    const teamDir = path.join(workDir, ".ai/memories/team");
    const files = await readdir(teamDir);
    const withContent = await Promise.all(
      files.map(async (f) => ({ f, c: await readFile(path.join(teamDir, f), "utf8") })),
    );
    const skill = withContent.find((x) => x.c.includes("type: skill"));
    expect(skill).toBeDefined();
    expect(skill!.c).toContain("activation:");
    expect(skill!.c).toContain("deploy");
    expect(skill!.c).toContain("scripts/**");
  });

  it("memory feedback records an applied outcome", async () => {
    const { stdout: addOut } = await run(workDir, [
      "memory", "add",
      "--type", "convention",
      "--slug", "fb-target",
      "--body", "A memory to give feedback on.",
      "--dir", workDir,
    ]);
    const id = /id=(\S+)/.exec(addOut)?.[1];
    expect(id).toBeTruthy();
    const { stdout } = await run(workDir, ["memory", "feedback", id!, "--applied", "--dir", workDir]);
    expect(stdout).toContain("Recorded 'applied'");
    expect(stdout).toContain("applied=1");
  });

  it("sensors promote flips an autogenerated sensor to block", async () => {
    await run(workDir, [
      "memory",
      "tried",
      "--what", "Enabling open in view",
      "--why-failed", "`open-in-view=true` leaks sessions.",
      "--instead", "keep open-in-view=false",
      "--paths", "src/app.properties",
      "--scope", "team",
      "--dir", workDir,
    ]);

    const teamDir = path.join(workDir, ".ai/memories/team");
    const files = await readdir(teamDir);
    const sensorFile = files.find((file) => file.includes("enabling-open-in-view"));
    expect(sensorFile).toBeDefined();
    const id = sensorFile!.replace(/\.md$/, "");
    let content = await readFile(path.join(teamDir, sensorFile!), "utf8");
    expect(content).toContain("sensor:");
    expect(content).toContain("severity: warn");

    await expect(run(workDir, ["sensors", "promote", id, "--dir", workDir])).rejects.toMatchObject({ code: 1 });

    const sensorlessFile = files.find((file) => file.includes("use-pnpm"));
    expect(sensorlessFile).toBeDefined();
    const sensorlessId = sensorlessFile!.replace(/\.md$/, "");
    await expect(
      run(workDir, ["sensors", "promote", sensorlessId, "--yes", "--dir", workDir]),
    ).rejects.toMatchObject({ code: 1 });

    await run(workDir, ["sensors", "promote", id, "--yes", "--dir", workDir]);

    content = await readFile(path.join(teamDir, sensorFile!), "utf8");
    expect(content).toContain("severity: block");
  });

  it("eval automatically includes .ai/eval/spec.json sensor cases", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-eval-spec-"));
    try {
      await run(repo, ["init", "--dir", repo, "--no-mcp-setup", "--stack", "none"]);
      await run(repo, [
        "memory",
        "tried",
        "--what", "Bad feature flag",
        "--why-failed", "`open-in-view=true` leaks sessions.",
        "--instead", "keep open-in-view=false",
        "--paths", "src/app.properties",
        "--scope", "team",
        "--dir", repo,
      ]);
      const teamFiles = await readdir(path.join(repo, ".ai/memories/team"));
      const sensorId = teamFiles.find((file) => file.includes("bad-feature-flag"))!.replace(/\.md$/, "");
      await mkdir(path.join(repo, ".ai/eval"), { recursive: true });
      await writeFile(
        path.join(repo, ".ai/eval/spec.json"),
        JSON.stringify({
          sensors: [
            {
              name: "feature flag regression",
              diff:
                "diff --git a/src/app.properties b/src/app.properties\n" +
                "+++ b/src/app.properties\n" +
                "@@\n" +
                "+open-in-view=true\n",
              paths: ["src/app.properties"],
              expect_fire_ids: [sensorId],
            },
          ],
        }, null, 2),
        "utf8",
      );

      const { stdout } = await run(repo, ["eval", "--json", "--dir", repo]);
      const report = JSON.parse(stdout) as {
        spec_source: string;
        report: { sensors: { catch_rate: number; cases: unknown[] } | null };
      };
      expect(report.spec_source).toContain(".ai/eval/spec.json");
      expect(report.report.sensors?.catch_rate).toBe(1);
      expect(report.report.sensors?.cases.length).toBe(1);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
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
    const file = teamFiles.find((item) => item.includes("use-pnpm"));
    expect(file).toBeDefined();
    const id = file!.replace(/\.md$/, "");
    const { stdout } = await run(workDir, ["memory", "show", id, "--dir", workDir]);
    expect(stdout).toContain(id);
    expect(stdout).toContain("scope:");
    expect(stdout).toContain("confidence:");
    expect(stdout).toContain("Always use pnpm");
  });

  // ── Phase A: CLI verbs mirror MCP tool names (mem_save/mem_search/mem_get/mem_delete) ──
  // Canonical verbs are save/search/get/delete; the old verbs add/query/show/rm stay as aliases.
  it("memory canonical verb 'search' works and 'query' alias still resolves", async () => {
    const canonical = await run(workDir, ["memory", "search", "tooling", "--dir", workDir]);
    const alias = await run(workDir, ["memory", "query", "tooling", "--dir", workDir]);
    expect(canonical.stdout).toContain("use-pnpm");
    // Same command behind both verbs → identical match line.
    expect(alias.stdout).toContain("use-pnpm");
  });

  it("memory canonical verb 'get' works and 'show' alias still resolves", async () => {
    const teamDir = path.join(workDir, ".ai/memories/team");
    const file = (await readdir(teamDir)).find((item) => item.includes("use-pnpm"));
    const id = file!.replace(/\.md$/, "");
    const canonical = await run(workDir, ["memory", "get", id, "--dir", workDir]);
    const alias = await run(workDir, ["memory", "show", id, "--dir", workDir]);
    expect(canonical.stdout).toContain("Always use pnpm");
    expect(alias.stdout).toContain("Always use pnpm");
  });

  it("default memory help surfaces canonical verbs and keeps old verbs as aliases", async () => {
    const { stdout } = await run(workDir, ["memory", "--help"]);
    // Canonical verbs visible in the core surface.
    expect(stdout).toContain("save");
    expect(stdout).toContain("search");
    expect(stdout).toContain("get");
    expect(stdout).toContain("delete");
    // Commander renders the alias next to the canonical name (e.g. "save|add").
    expect(stdout).toContain("add");
    expect(stdout).toContain("query");
  });

  it("memory lint --fix dry-run reports simple fixes and --apply writes headings", async () => {
    const malformed = path.join(workDir, ".ai/memories/team/2099-01-01-decision-lint-heading-fix.md");
    await writeFile(malformed, [
      "---",
      "id: 2099-01-01-decision-lint-heading-fix",
      "scope: team",
      "type: decision",
      "status: validated",
      "created_at: 2099-01-01T00:00:00.000Z",
      "anchor:",
      "  paths: []",
      "  symbols: []",
      "tags: []",
      "---",
      "Always keep API stable because clients depend on it.",
      "",
    ].join("\n"), "utf8");

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

  it("enforce pre-tool-use blocks writes to files with unbriefed anchored policies", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-targeted-pretool-"));
    try {
      await run(repo, ["init", "--dir", repo, "--no-mcp-setup", "--stack", "none"]);
      await mkdir(path.join(repo, "src"), { recursive: true });
      await writeFile(path.join(repo, "src", "guarded.ts"), "export const guarded = true;\n", "utf8");
      await run(repo, [
        "memory", "add",
        "--type", "decision",
        "--slug", "guarded-edit-policy",
        "--paths", "src/guarded.ts",
        "--body", "Always load the guarded edit policy before changing this file.",
        "--dir", repo,
      ]);

      const markerDir = path.join(repo, ".ai/.runtime/enforcement/briefings");
      await mkdir(markerDir, { recursive: true });
      await writeFile(path.join(markerDir, "targeted-session.json"), JSON.stringify({
        session_id: "targeted-session",
        task: "generic briefing",
        source: "test",
        created_at: new Date().toISOString(),
        root: repo,
        memory_ids: [],
      }, null, 2), "utf8");

      const payload = JSON.stringify({
        cwd: repo,
        session_id: "targeted-session",
        tool_name: "Write",
        tool_input: { file_path: "src/guarded.ts" },
      });
      const blocked = await runWithInput(repo, ["enforce", "pre-tool-use", "--dir", repo], payload);
      expect(blocked.code).toBe(2);
      expect(blocked.stderr).toContain("required hAIve context");
      expect(blocked.stderr).toContain("guarded-edit-policy");

      const teamFiles = await readdir(path.join(repo, ".ai/memories/team"));
      const memoryId = teamFiles.find((file) => file.includes("guarded-edit-policy"))!.replace(/\.md$/, "");
      await writeFile(path.join(markerDir, "targeted-session.json"), JSON.stringify({
        session_id: "targeted-session",
        task: "targeted briefing",
        source: "test",
        created_at: new Date().toISOString(),
        root: repo,
        memory_ids: [memoryId],
      }, null, 2), "utf8");

      const allowed = await runWithInput(repo, ["enforce", "pre-tool-use", "--dir", repo], payload);
      expect(allowed.code).toBe(0);
      expect(allowed.stderr).toBe("");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
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

  it("enforce cleanup preserves cache ignores and briefing markers", async () => {
    await run(workDir, ["briefing", "--task", "cleanup preservation smoke", "--budget", "quick", "--dir", workDir]);
    const cacheDir = path.join(workDir, ".ai/.cache");
    const runtimeScratch = path.join(workDir, ".ai/.runtime/scratch");
    await mkdir(cacheDir, { recursive: true });
    await mkdir(runtimeScratch, { recursive: true });
    await writeFile(path.join(cacheDir, "temporary.json"), "{}", "utf8");
    await writeFile(path.join(runtimeScratch, "temporary.txt"), "scratch", "utf8");

    await run(workDir, ["enforce", "cleanup", "--dir", workDir]);

    expect(existsSync(path.join(cacheDir, ".gitignore"))).toBe(true);
    expect(existsSync(path.join(cacheDir, "temporary.json"))).toBe(false);
    expect(existsSync(runtimeScratch)).toBe(false);
    expect(existsSync(path.join(workDir, ".ai/.runtime/enforcement/briefings/default.json"))).toBe(true);

    const { stdout } = await run(workDir, ["enforce", "status", "--json", "--dir", workDir]);
    const report = JSON.parse(stdout) as { should_block: boolean; findings: Array<{ code: string }> };
    expect(report.should_block).toBe(false);
    expect(report.findings.some((f) => f.code === "briefing-loaded")).toBe(true);
  });

  it("precommit --json stays machine-readable when no files are staged", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-precommit-json-"));
    try {
      await exec("git", ["init"], { cwd: repo });
      await run(repo, ["init", "--dir", repo, "--no-mcp-setup", "--stack", "none"]);

      const { stdout, stderr } = await run(repo, ["precommit", "--json", "--dir", repo]);
      const report = JSON.parse(stdout) as {
        should_block: boolean;
        summary: { anti_patterns: number; relevant_memories: number; stale_anchors: number };
        notice?: string;
      };

      expect(stderr).toBe("");
      expect(report.should_block).toBe(false);
      expect(report.summary.anti_patterns).toBe(0);
      expect(report.summary.relevant_memories).toBe(0);
      expect(report.summary.stale_anchors).toBe(0);
      expect(report.notice).toContain("No staged changes");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("session end --auto falls back to a git diff recap when no observation log exists", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-auto-session-end-"));
    try {
      await exec("git", ["init"], { cwd: repo });
      await run(repo, ["init", "--dir", repo, "--no-mcp-setup", "--stack", "none"]);
      await mkdir(path.join(repo, "src"), { recursive: true });
      await writeFile(path.join(repo, "src", "changed.ts"), "export const changed = true;\n", "utf8");

      const { stdout } = await run(repo, ["session", "end", "--auto", "--dir", repo]);

      expect(stdout).toContain("Session recap");
      const personalDir = path.join(repo, ".ai/memories/personal");
      const files = await readdir(personalDir);
      const recapFile = files.find((file) => file.includes("session_recap"))!;
      const content = await readFile(path.join(personalDir, recapFile), "utf8");
      // New format: meaningful goal derived from file count or recent commits, not raw bash commands
      expect(content).toMatch(/Session with \d+ changed file|Session with recent commits/);
      // git porcelain groups untracked files by parent dir, so src/ may appear instead of src/changed.ts
      expect(content).toMatch(/src\/changed\.ts|src\//)
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
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

  it("CI enforcement scans the committed base/head diff, not only staged changes", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-ci-diff-"));
    try {
      await exec("git", ["init"], { cwd: repo });
      await exec("git", ["config", "user.email", "test@example.com"], { cwd: repo });
      await exec("git", ["config", "user.name", "hAIve Test"], { cwd: repo });
      await mkdir(path.join(repo, "src"), { recursive: true });
      await writeFile(path.join(repo, "src/status.ts"), "export const status = \"OK\";\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "initial"], { cwd: repo });

      await run(repo, ["init", "--manual", "--no-mcp-setup", "--stack", "none", "--no-bootstrap", "--dir", repo]);
      await writeFile(
        path.join(repo, ".ai/memories/team/2026-01-01-attempt-lowercase-status.md"),
        [
          "---",
          "id: 2026-01-01-attempt-lowercase-status",
          "scope: team",
          "type: attempt",
          "status: validated",
          "created_at: '2026-01-01T00:00:00.000Z'",
          "anchor:",
          "  paths: [src/status.ts]",
          "  symbols: []",
          "tags: []",
          "---",
          "# lowercase status",
          "",
          "Using lowercase status ok failed. Return uppercase OK or KO.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(path.join(repo, "src/status.ts"), "export const status = \"ok\";\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "--no-verify", "-m", "introduce lowercase status"], { cwd: repo });

      // Isolate from the ambient GitHub Actions env: on the CI runner GITHUB_SHA /
      // GITHUB_BASE_REF / GITHUB_EVENT_PATH point at the hAIve CI commit (absent from
      // this temp repo), which made `enforce ci` diff an unknown SHA → empty diff →
      // exit 0. Clearing them makes it diff this repo's own HEAD~1..HEAD as intended.
      const result = await runAllowFailure(repo, ["enforce", "ci", "--json", "--dir", repo], {
        GITHUB_SHA: "",
        GITHUB_BASE_REF: "",
        GITHUB_HEAD_REF: "",
        GITHUB_REF: "",
        GITHUB_EVENT_PATH: "",
        HAIVE_BASE_SHA: "",
        HAIVE_HEAD_SHA: "",
        HAIVE_BASE_REF: "",
      });
      const report = JSON.parse(result.stdout) as {
        should_block: boolean;
        findings: Array<{ code: string; severity: string }>;
      };

      expect(result.code).toBe(2);
      expect(report.should_block).toBe(true);
      expect(report.findings.some((f) => f.code === "precommit-policy-block")).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("CI enforcement reconstructs decision coverage without a local briefing marker", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-ci-decision-coverage-"));
    try {
      await exec("git", ["init"], { cwd: repo });
      await exec("git", ["config", "user.email", "test@example.com"], { cwd: repo });
      await exec("git", ["config", "user.name", "hAIve Test"], { cwd: repo });
      await mkdir(path.join(repo, "src"), { recursive: true });
      await writeFile(path.join(repo, "src/guarded.ts"), "export const guarded = true;\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "initial"], { cwd: repo });

      await run(repo, ["init", "--manual", "--no-mcp-setup", "--stack", "none", "--no-bootstrap", "--dir", repo]);
      await writeFile(
        path.join(repo, ".ai/memories/team/2026-01-01-decision-guarded-file.md"),
        [
          "---",
          "id: 2026-01-01-decision-guarded-file",
          "scope: team",
          "type: decision",
          "status: validated",
          "created_at: '2026-01-01T00:00:00.000Z'",
          "anchor:",
          "  paths: [src/guarded.ts]",
          "  symbols: []",
          "tags: []",
          "---",
          "# Guarded file policy",
          "",
          "This file is guarded by a repo-specific policy.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(path.join(repo, "src/guarded.ts"), "export const guarded = false;\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "--no-verify", "-m", "change guarded file"], { cwd: repo });

      const result = await runAllowFailure(repo, ["enforce", "ci", "--json", "--dir", repo], {
        GITHUB_SHA: "",
        GITHUB_BASE_REF: "",
        GITHUB_HEAD_REF: "",
        GITHUB_REF: "",
        GITHUB_EVENT_PATH: "",
        HAIVE_BASE_SHA: "",
        HAIVE_HEAD_SHA: "",
        HAIVE_BASE_REF: "",
      });
      const report = JSON.parse(result.stdout) as {
        should_block: boolean;
        findings: Array<{ code: string; severity: string; memory_ids?: string[] }>;
      };

      expect(result.code).toBe(0);
      expect(report.should_block).toBe(false);
      const coverage = report.findings.find((f) => f.code === "decision-coverage-ci-pass");
      expect(coverage?.severity).toBe("ok");
      expect(coverage?.memory_ids).toContain("2026-01-01-decision-guarded-file");
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("finish gate blocks shippable work left as an uncommitted local diff", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-finish-dirty-"));
    try {
      await exec("git", ["init", "-b", "main"], { cwd: repo });
      await exec("git", ["config", "user.email", "test@example.com"], { cwd: repo });
      await exec("git", ["config", "user.name", "hAIve Test"], { cwd: repo });
      await writeLockstepPackageJsons(repo, "0.1.0");
      await run(repo, ["init", "--manual", "--no-mcp-setup", "--stack", "none", "--no-bootstrap", "--dir", repo]);
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "initial"], { cwd: repo });

      await mkdir(path.join(repo, "packages/cli/src"), { recursive: true });
      await writeFile(path.join(repo, "packages/cli/src/index.ts"), "export const changed = true;\n", "utf8");

      const result = await runAllowFailure(repo, ["enforce", "finish", "--json", "--dir", repo]);
      const report = JSON.parse(result.stdout) as {
        should_block: boolean;
        findings: Array<{ code: string; severity: string }>;
      };

      expect(result.code).toBe(2);
      expect(report.should_block).toBe(true);
      expect(report.findings.some((f) => f.code === "git-sync-uncommitted-shippable")).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it("finish gate blocks committed shippable changes without a lockstep version bump", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-finish-version-"));
    const remote = await mkdtemp(path.join(tmpdir(), "haive-finish-remote-"));
    try {
      await exec("git", ["init", "--bare"], { cwd: remote });
      await exec("git", ["init", "-b", "main"], { cwd: repo });
      await exec("git", ["config", "user.email", "test@example.com"], { cwd: repo });
      await exec("git", ["config", "user.name", "hAIve Test"], { cwd: repo });
      await writeLockstepPackageJsons(repo, "0.1.0");
      await mkdir(path.join(repo, "packages/cli/src"), { recursive: true });
      await writeFile(path.join(repo, "packages/cli/src/index.ts"), "export const initial = true;\n", "utf8");
      await run(repo, ["init", "--manual", "--no-mcp-setup", "--stack", "none", "--no-bootstrap", "--dir", repo]);
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "initial"], { cwd: repo });
      await exec("git", ["remote", "add", "origin", remote], { cwd: repo });
      await exec("git", ["push", "-u", "origin", "main"], { cwd: repo });

      await writeFile(path.join(repo, "packages/cli/src/index.ts"), "export const initial = true;\nexport const changed = true;\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "change shippable code without bump"], { cwd: repo });

      const result = await runAllowFailure(repo, ["enforce", "finish", "--json", "--dir", repo]);
      const report = JSON.parse(result.stdout) as {
        should_block: boolean;
        findings: Array<{ code: string; severity: string }>;
      };

      expect(result.code).toBe(2);
      expect(report.should_block).toBe(true);
      expect(report.findings.some((f) => f.code === "release-version-missing")).toBe(true);
      expect(report.findings.some((f) => f.code === "git-sync-unpushed-commits")).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("finish gate blocks already-pushed shippable HEAD changes without a lockstep version bump", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-finish-pushed-version-"));
    const remote = await mkdtemp(path.join(tmpdir(), "haive-finish-pushed-remote-"));
    try {
      await exec("git", ["init", "--bare"], { cwd: remote });
      await exec("git", ["init", "-b", "main"], { cwd: repo });
      await exec("git", ["config", "user.email", "test@example.com"], { cwd: repo });
      await exec("git", ["config", "user.name", "hAIve Test"], { cwd: repo });
      await writeLockstepPackageJsons(repo, "0.1.0");
      await mkdir(path.join(repo, "packages/cli/src"), { recursive: true });
      await writeFile(path.join(repo, "packages/cli/src/index.ts"), "export const initial = true;\n", "utf8");
      await run(repo, ["init", "--manual", "--no-mcp-setup", "--stack", "none", "--no-bootstrap", "--dir", repo]);
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "initial"], { cwd: repo });
      await exec("git", ["remote", "add", "origin", remote], { cwd: repo });
      await exec("git", ["push", "-u", "origin", "main"], { cwd: repo });

      await writeFile(path.join(repo, "packages/cli/src/index.ts"), "export const initial = true;\nexport const pushed = true;\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "push shippable code without bump"], { cwd: repo });
      await exec("git", ["push"], { cwd: repo });

      const result = await runAllowFailure(repo, ["enforce", "finish", "--json", "--dir", repo]);
      const report = JSON.parse(result.stdout) as {
        should_block: boolean;
        findings: Array<{ code: string; severity: string }>;
      };

      expect(result.code).toBe(2);
      expect(report.should_block).toBe(true);
      expect(report.findings.some((f) => f.code === "release-version-missing")).toBe(true);
      expect(report.findings.some((f) => f.code === "git-sync-unpushed-commits")).toBe(false);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
    }
  });

  it("finish gate blocks when pushed GitHub Actions runs did not pass", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-finish-actions-failed-"));
    const remote = await mkdtemp(path.join(tmpdir(), "haive-finish-actions-remote-"));
    const fakeBin = await mkdtemp(path.join(tmpdir(), "haive-finish-actions-bin-"));
    try {
      await exec("git", ["init", "--bare"], { cwd: remote });
      await exec("git", ["init", "-b", "main"], { cwd: repo });
      await exec("git", ["config", "user.email", "test@example.com"], { cwd: repo });
      await exec("git", ["config", "user.name", "hAIve Test"], { cwd: repo });
      await writeLockstepPackageJsons(repo, "0.1.0");
      await writeFile(path.join(repo, "README.md"), "Initial docs.\n", "utf8");
      await run(repo, ["init", "--manual", "--no-mcp-setup", "--stack", "none", "--no-bootstrap", "--dir", repo]);
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "initial"], { cwd: repo });
      await exec("git", ["remote", "add", "origin", remote], { cwd: repo });
      await exec("git", ["push", "-u", "origin", "main"], { cwd: repo });

      await writeFile(path.join(repo, "README.md"), "Initial docs.\nUpdated docs.\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "docs update"], { cwd: repo });
      await exec("git", ["push"], { cwd: repo });
      await exec("git", ["remote", "set-url", "origin", "https://github.com/example/haive-test.git"], { cwd: repo });
      await writeFile(
        path.join(fakeBin, "gh"),
        "#!/bin/sh\nprintf '%s\\n' '[{\"databaseId\":123,\"workflowName\":\"ci\",\"status\":\"completed\",\"conclusion\":\"failure\"}]'\n",
        "utf8",
      );
      await chmod(path.join(fakeBin, "gh"), 0o755);

      const result = await runAllowFailure(repo, ["enforce", "finish", "--json", "--dir", repo], {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      });
      const report = JSON.parse(result.stdout) as {
        should_block: boolean;
        findings: Array<{ code: string; severity: string }>;
      };

      expect(result.code).toBe(2);
      expect(report.should_block).toBe(true);
      expect(report.findings.some((f) => f.code === "github-actions-failed")).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
      await rm(fakeBin, { recursive: true, force: true });
    }
  });

  it("finish gate passes only after pushed GitHub Actions runs are successful", async () => {
    const repo = await mkdtemp(path.join(tmpdir(), "haive-finish-actions-pass-"));
    const remote = await mkdtemp(path.join(tmpdir(), "haive-finish-actions-pass-remote-"));
    const fakeBin = await mkdtemp(path.join(tmpdir(), "haive-finish-actions-pass-bin-"));
    try {
      await exec("git", ["init", "--bare"], { cwd: remote });
      await exec("git", ["init", "-b", "main"], { cwd: repo });
      await exec("git", ["config", "user.email", "test@example.com"], { cwd: repo });
      await exec("git", ["config", "user.name", "hAIve Test"], { cwd: repo });
      await writeLockstepPackageJsons(repo, "0.1.0");
      await writeFile(path.join(repo, "README.md"), "Initial docs.\n", "utf8");
      await run(repo, ["init", "--manual", "--no-mcp-setup", "--stack", "none", "--no-bootstrap", "--dir", repo]);
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "initial"], { cwd: repo });
      await exec("git", ["remote", "add", "origin", remote], { cwd: repo });
      await exec("git", ["push", "-u", "origin", "main"], { cwd: repo });

      await writeFile(path.join(repo, "README.md"), "Initial docs.\nUpdated docs.\n", "utf8");
      await exec("git", ["add", "."], { cwd: repo });
      await exec("git", ["commit", "-m", "docs update"], { cwd: repo });
      await exec("git", ["push"], { cwd: repo });
      await exec("git", ["remote", "set-url", "origin", "https://github.com/example/haive-test.git"], { cwd: repo });
      await writeFile(
        path.join(fakeBin, "gh"),
        "#!/bin/sh\nprintf '%s\\n' '[{\"databaseId\":123,\"workflowName\":\"ci\",\"status\":\"completed\",\"conclusion\":\"success\"}]'\n",
        "utf8",
      );
      await chmod(path.join(fakeBin, "gh"), 0o755);

      const result = await runAllowFailure(repo, ["enforce", "finish", "--json", "--dir", repo], {
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      });
      const report = JSON.parse(result.stdout) as {
        should_block: boolean;
        findings: Array<{ code: string; severity: string }>;
      };

      expect(result.code).toBe(0);
      expect(report.should_block).toBe(false);
      expect(report.findings.some((f) => f.code === "github-actions-pass")).toBe(true);
    } finally {
      await rm(repo, { recursive: true, force: true });
      await rm(remote, { recursive: true, force: true });
      await rm(fakeBin, { recursive: true, force: true });
    }
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

  it("doctor --json reports stale-draft-memories when a draft is older than 30 days", async () => {
    const draftDir = await mkdtemp(path.join(tmpdir(), "haive-doctor-draft-test-"));
    try {
      await run(draftDir, ["init", "--dir", draftDir, "--no-mcp-setup"]);
      // Write a memory with draft status and a created_at > 30 days ago
      const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString();
      const memId = "2020-01-01-decision-old-draft";
      await writeFile(
        path.join(draftDir, ".ai/memories/team", `${memId}.md`),
        [
          "---",
          `id: ${memId}`,
          "scope: team",
          "type: decision",
          "status: draft",
          `created_at: '${oldDate}'`,
          "anchor:",
          "  paths: []",
          "  symbols: []",
          "tags: []",
          "---",
          "# Old draft decision",
          "",
          "This has been sitting in draft for a long time.",
        ].join("\n"),
        "utf8",
      );
      const { stdout } = await run(draftDir, ["doctor", "--json", "--dir", draftDir]);
      const report = JSON.parse(stdout) as { findings: Array<{ code: string; message: string }> };
      const finding = report.findings.find((f) => f.code === "stale-draft-memories");
      expect(finding).toBeDefined();
      expect(finding?.message).toContain(memId);
    } finally {
      await rm(draftDir, { recursive: true, force: true });
    }
  });
});
