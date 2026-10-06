import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildFrontmatter, serializeMemory, resolveHaivePaths, loadTaskSession } from "@hivelore/core";
import { exerciseHarness } from "../src/utils/harness-proof.js";
import { writeBridgeFiles } from "../src/utils/bridge-files.js";
const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../dist/index.js", import.meta.url));
let root: string;
const run = (args: string[]) => exec(process.execPath, [cli, ...args], { cwd: root, timeout: 30000 });
const git = (args: string[]) => exec("git", args, { cwd: root });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "hivelore-product-"));
  await git(["init", "-b", "main"]); await git(["config", "user.name", "Test"]); await git(["config", "user.email", "test@example.invalid"]);
  await mkdir(path.join(root, ".ai/memories/team"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), ".ai/.runtime/\n.ai/.cache/\n.ai/.usage/\n");
  await writeFile(path.join(root, ".ai/hivelore.config.json"), JSON.stringify({ autopilot: false, enforcement: { mode: "advisory", completionMode: "local" } }));
  await writeFile(path.join(root, "source.ts"), "approved();\n");
  await git(["add", "."]); await git(["commit", "-m", "fixture"]);
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
function hook(args: string[], payload: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: root, stdio: ["pipe", "pipe", "pipe"], timeout: 15000 });
    let text = "", err = ""; child.stdout.on("data", c => text += c); child.stderr.on("data", c => err += c);
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(text) : reject(new Error(err)));
    child.stdin.end(JSON.stringify(payload));
  });
}
describe("complete product paths", () => {
  it("exercises MCP-independent hooks and validated GREEN/RED protection in an isolated repo", async () => {
    expect(await exerciseHarness(cli)).toMatchObject({ passed: true, synthetic: true });
  }, 30000);
  it("captures a short lesson without a mandatory type, slug or boilerplate", async () => {
    const result = await run(["memory", "save", "Use minor units because this project supports XOF.", "--files", "source.ts"]);
    expect(result.stdout).toContain("Created");
    const { readdir } = await import("node:fs/promises");
    const p = resolveHaivePaths(root);
    const files = await readdir(p.personalDir);
    const raw = await readFile(path.join(p.personalDir, files[0]!), "utf8");
    expect(raw).toContain("Use minor units"); expect(raw).not.toContain("Recorded in Hivelore so");
  });
  it("preserves the original task baseline after compaction", async () => {
    await hook(["enforce", "session-start", "--mode", "local", "--task", "Fix the API"], { cwd: root, session_id: "compact", source: "startup" });
    const paths = resolveHaivePaths(root);
    const before = await loadTaskSession(paths, "compact");
    await writeFile(path.join(root, "source.ts"), "changed();\n");
    await hook(["enforce", "session-start"], { cwd: root, session_id: "compact", source: "compact" });
    const after = await loadTaskSession(paths, "compact");
    expect(after?.baseline).toEqual(before?.baseline); expect(after?.started_at).toEqual(before?.started_at);
    expect(after?.task).toBe("Fix the API");
  });
  it("does not inject an anchored memory on a successful read", async () => {
    const fm = buildFrontmatter({ type: "decision", slug: "rule", scope: "team", status: "validated", paths: ["source.ts"] });
    await writeFile(path.join(root, ".ai/memories/team", `${fm.id}.md`), serializeMemory({ frontmatter: fm, body: "Use the approved client." }));
    await hook(["enforce", "session-start"], { cwd: root, session_id: "read" });
    const output = await hook(["observe"], { cwd: root, session_id: "read", tool_name: "Bash", tool_input: { command: "cat source.ts" }, tool_response: { exit_code: 0 } });
    expect(output).toBe("");
  });
  it("keeps default bridges unchanged when unrelated memories are added", async () => {
    const paths = resolveHaivePaths(root);
    await writeBridgeFiles(root, paths, { targets: ["agents"] });
    const original = await readFile(path.join(root, "AGENTS.md"), "utf8");
    const fm = buildFrontmatter({ type: "gotcha", slug: "new-note", scope: "team", status: "validated", paths: ["source.ts"] });
    await writeFile(path.join(paths.teamDir, `${fm.id}.md`), serializeMemory({ frontmatter: fm, body: "A new discovery." }));
    await writeBridgeFiles(root, paths, { targets: ["agents"] });
    expect(await readFile(path.join(root, "AGENTS.md"), "utf8")).toBe(original);
  });
  it("rejects duplicate benchmark tasks before creating partial runs", async () => {
    await writeFile(path.join(root, "suite.json"), JSON.stringify({ cases: [{ id: "same" }, { id: "same" }] }));
    await expect(run(["benchmark", "prepare", "--suite", "suite.json", "--out", "runs", "--model", "same-model"])).rejects.toThrow();
    const { access } = await import("node:fs/promises");
    await expect(access(path.join(root, "runs"))).rejects.toThrow();
  });
  it("matches report evidence to every prepared run, rejecting altered manifests and missing arms", async () => {
    await writeFile(path.join(root, "suite.json"), JSON.stringify({ cases: Array.from({ length: 10 }, (_, i) => ({ id: `task${i}` })) }));
    await run(["benchmark", "prepare", "--suite", "suite.json", "--out", "runs", "--model", "same-model"]);
    const protocol = JSON.parse(await readFile(path.join(root, "runs/protocol.json"), "utf8"));
    for (const r of protocol.runs) {
      const report = ["# Report", "## Outcome", "- Task completed: yes", "- Tests passed: yes", "- Policy violations: 0",
        "- Duration seconds: 10", "- Total tokens: 100", "- Human interventions: 0", "- Runner ID: agent", "- Evaluator ID: reviewer",
        "- Independent evaluation: yes", `- Model: ${r.model}`, `- Checkout: ${r.checkout}`, `- Budget: ${r.budget}`, "- Prompt hash: identical-task-prompt"].join("\n");
      await writeFile(path.join(root, "runs", `${r.task}-r${r.repetition}-${r.arm}`, "BENCHMARK_AGENT_REPORT.md"), report);
    }
    const report = async () => JSON.parse((await run(["benchmark", "report", "--dir", path.join(root, "runs"), "--json"])).stdout);
    expect((await report()).summary.evidence_grade).toBe("decision-ready");
    const first = protocol.runs[0];
    const manifest = path.join(root, "runs", `${first.task}-r${first.repetition}-${first.arm}`, "run.json");
    await writeFile(manifest, JSON.stringify({ ...first, model: "changed" }));
    expect((await report()).summary.evidence_grade).toBe("insufficient");
    await writeFile(manifest, JSON.stringify(first));
    for (const r of protocol.runs.filter((r: { arm: string }) => r.arm === "context")) {
      await rm(path.join(root, "runs", `${r.task}-r${r.repetition}-${r.arm}`), { recursive: true });
    }
    expect((await report()).summary.evidence_grade).toBe("insufficient");
  });
  it("prepares balanced comparisons and never claims evidence from empty report templates", async () => {
    await writeFile(path.join(root, "suite.json"), JSON.stringify({ cases: [{ id: "task-one" }] }));
    await run(["benchmark", "prepare", "--suite", "suite.json", "--out", "runs", "--model", "same-model"]);
    const protocol = JSON.parse(await readFile(path.join(root, "runs/protocol.json"), "utf8"));
    expect(protocol.runs).toHaveLength(9);
    expect(new Set(protocol.runs.map((r: { arm: string }) => r.arm)).size).toBe(3);
    const report = JSON.parse((await run(["benchmark", "report", "--dir", path.join(root, "runs"), "--json"])).stdout);
    expect(report.summary.evidence_grade).toBe("insufficient");
  });
});
