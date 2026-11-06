import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildFrontmatter, renderHiveloreSkill, resolveHaivePaths, serializeMemory, type ArmPlan } from "@hivelore/core";
import { validateArmPlan } from "../src/commands/rules.js";
import { pluginHookShadowed } from "../src/utils/hook-source.js";
import { runPreEdit } from "../src/utils/pre-edit.js";
import { handleUserPrompt, readRecordedCorrections } from "../src/utils/user-prompt.js";

const REPO = path.resolve(__dirname, "../../..");

async function repoWithGuard(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "hivelore-guard-"));
  const paths = resolveHaivePaths(root);
  await mkdir(paths.teamDir, { recursive: true });
  const fm = buildFrontmatter({
    type: "convention", slug: "no-npm-publish", scope: "team", status: "validated",
    sensor: { kind: "command", pattern: "(?<![\\w-])npm\\s+publish(?![\\w-])", paths: [], message: "Publication goes through the release workflow.", severity: "block", autogen: false, last_fired: null },
  });
  await writeFile(path.join(paths.teamDir, `${fm.id}.md`), serializeMemory({ frontmatter: fm, body: "# No npm publish\n\nCI publishes." }), "utf8");
  return root;
}

describe("command guards in the PreToolUse hook", () => {
  let root: string;
  let out: string[];
  beforeEach(async () => {
    root = await repoWithGuard();
    out = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => { out.push(String(line)); });
  });
  afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

  it("denies a forbidden command before it runs, with the reason", async () => {
    await runPreEdit({ cwd: root, session_id: "s", tool_name: "Bash", tool_input: { command: "npm publish --access public" } }, root);
    const decision = JSON.parse(out[0]!) as { hookSpecificOutput: { permissionDecision: string; permissionDecisionReason: string } };
    expect(decision.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(decision.hookSpecificOutput.permissionDecisionReason).toContain("release workflow");
  });

  it("lets a commit message that merely mentions it through", async () => {
    await runPreEdit({ cwd: root, session_id: "s", tool_name: "Bash", tool_input: { command: 'git commit -m "never npm publish from a laptop"' } }, root);
    expect(out.join("\n")).not.toContain("deny");
  });
});

describe("developer corrections (UserPromptSubmit)", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "hivelore-prompt-")); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it("in a Hivelore repo: nudges the agent and records the rule for memory propose", async () => {
    await mkdir(path.join(root, ".ai", "memories", "team"), { recursive: true });
    const context = await handleUserPrompt({ cwd: root, session_id: "p1", prompt: "No. We never mock the database in integration tests." }, root);
    expect(context).toContain("offer ONCE to record it");
    const recorded = await readRecordedCorrections(resolveHaivePaths(root).cacheDir);
    expect(recorded.map((r) => r.rule)).toEqual(["We never mock the database in integration tests."]);
  });

  it("elsewhere: offers Hivelore once per session, and stays silent on ordinary messages", async () => {
    const prompt = "Stop — in this project we always use pnpm, never npm.";
    const session = `p2-${Date.now()}`;
    expect(await handleUserPrompt({ cwd: root, session_id: session, prompt }, root)).toContain("npx @hivelore/cli init");
    expect(await handleUserPrompt({ cwd: root, session_id: session, prompt }, root)).toBeNull();
    expect(existsSync(path.join(root, ".ai"))).toBe(false); // nothing written into a repo that never asked
    expect(await handleUserPrompt({ cwd: root, session_id: "p3", prompt: "Please add a retry to the webhook handler." }, root)).toBeNull();
  });
});

describe("plugin hooks step aside when the settings already run Hivelore", () => {
  it("only shadows plugin-sourced calls", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hivelore-shadow-"));
    await mkdir(path.join(root, ".claude"), { recursive: true });
    await writeFile(path.join(root, ".claude", "settings.local.json"), JSON.stringify({ hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "hivelore enforce pre-tool-use", haive_tag: "haive-enforcement" }] }] } }));
    expect(pluginHookShadowed(root, { HIVELORE_HOOK_SOURCE: "plugin" } as NodeJS.ProcessEnv)).toBe(true);
    expect(pluginHookShadowed(root, {} as NodeJS.ProcessEnv)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });
});

describe("rules arm validation", () => {
  it("counts existing occurrences and refuses a pattern that misses its own example", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "hivelore-arm-"));
    execFileSync("git", ["init", "-q"], { cwd: root });
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "a.ts"), "const d = LocalDate.now();\n");
    execFileSync("git", ["add", "-A"], { cwd: root });
    const rule = { file: "CLAUDE.md", line: 3, text: "Never call `LocalDate.now()`.", class: "checkable" as const };
    const plan: ArmPlan = { rule, kind: "regex", pattern: "\\bLocalDate\\.now\\(\\)", bad_example: "LocalDate.now()", severity: "warn", message: "m", slug: "s", reason: "r" };
    expect(validateArmPlan(plan, root)).toMatchObject({ ok: true, existing: 1 });
    expect(validateArmPlan({ ...plan, pattern: "nope" }, root).ok).toBe(false);
    const guard: ArmPlan = { ...plan, kind: "command", pattern: "git", bad_example: "git push --tags" };
    expect(validateArmPlan(guard, root)).toMatchObject({ ok: false, note: expect.stringContaining("commit message") });
    await rm(root, { recursive: true, force: true });
  });
});

describe("the Claude Code plugin ships in lockstep", () => {
  const version = (JSON.parse(readFileSync(path.join(REPO, "packages/cli/package.json"), "utf8")) as { version: string }).version;

  it("carries the CLI version everywhere and the one skill source", () => {
    const plugin = JSON.parse(readFileSync(path.join(REPO, "plugins/hivelore/.claude-plugin/plugin.json"), "utf8")) as { version: string; name: string };
    const market = JSON.parse(readFileSync(path.join(REPO, ".claude-plugin/marketplace.json"), "utf8")) as { plugins: Array<{ name: string; version: string; source: string }> };
    expect(plugin).toMatchObject({ name: "hivelore", version });
    expect(market.plugins[0]).toMatchObject({ name: "hivelore", version, source: "./plugins/hivelore" });
    expect(readFileSync(path.join(REPO, "plugins/hivelore/bin/hivelore-hook"), "utf8")).toContain(`@hivelore/cli@${version}`);
    expect(readFileSync(path.join(REPO, "plugins/hivelore/skills/hivelore/SKILL.md"), "utf8")).toBe(renderHiveloreSkill());
    const hooks = JSON.parse(readFileSync(path.join(REPO, "plugins/hivelore/hooks/hooks.json"), "utf8")) as { hooks: Record<string, unknown> };
    expect(Object.keys(hooks.hooks).sort()).toEqual(["PostToolUse", "PreToolUse", "SessionEnd", "SessionStart", "UserPromptSubmit"]);
  });
});
