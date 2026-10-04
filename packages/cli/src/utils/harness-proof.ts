import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFrontmatter, serializeMemory } from "@hivelore/core";
const exec = promisify(execFile);

/** Reproducible synthetic proof. Never touches the user's code, hooks, config or Git index. */
export async function exerciseHarness(cliEntry: string) {
  const root = await mkdtemp(path.join(tmpdir(), "hivelore-proof-"));
  const run = async (args: string[]) => {
    try { return { ...(await exec(process.execPath, [cliEntry, ...args], { cwd: root, timeout: 30_000 })), code: 0 }; }
    catch (e) { const err = e as { stdout?: string; stderr?: string; code?: number }; return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: err.code ?? 1 }; }
  };
  const git = (args: string[]) => exec("git", args, { cwd: root, timeout: 10_000 });
  try {
    await git(["init", "-b", "main"]);
    await git(["config", "user.name", "Hivelore diagnostic"]);
    await git(["config", "user.email", "diagnostic@example.invalid"]);
    await mkdir(path.join(root, ".ai/memories/team"), { recursive: true });
    await writeFile(path.join(root, ".gitignore"), ".ai/.runtime/\n.ai/.cache/\n.ai/.usage/\n");
    await writeFile(path.join(root, ".ai/hivelore.config.json"), JSON.stringify({ autopilot: false, enforcement: { mode: "strict" } }));
    await writeFile(path.join(root, ".ai/project-context.md"), "# Diagnostic fixture\nUse approvedClient for this synthetic example.\n");
    await writeFile(path.join(root, "source.ts"), "approvedClient();\n");
    const fm = buildFrontmatter({ type: "gotcha", slug: "synthetic-client-policy", scope: "team", status: "validated", paths: ["source.ts"] });
    await writeFile(path.join(root, ".ai/memories/team", `${fm.id}.md`), serializeMemory({ frontmatter: fm, body: "Use approvedClient because the synthetic legacy client violates the fixture policy." }));
    await git(["add", "."]); await git(["commit", "-m", "Synthetic fixture"]);
    const proposal = await run(["sensors", "propose", fm.id, "--pattern", "legacyClient\\(", "--bad-example", "legacyClient();", "--message", "Use approvedClient", "--severity", "block", "--json"]);
    if (proposal.code !== 0) throw new Error(`Synthetic sensor validation failed: ${proposal.stdout || proposal.stderr}`);
    await git(["add", ".ai"]); await git(["commit", "-m", "Validated synthetic sensor"]);
    await writeFile(path.join(root, "source.ts"), "approvedClient();\napprovedClient();\n"); await git(["add", "source.ts"]);
    const green = await run(["sensors", "check", "--json"]);
    await writeFile(path.join(root, "source.ts"), "legacyClient();\n"); await git(["add", "source.ts"]);
    const red = await run(["sensors", "check", "--json"]);
    const payload = JSON.stringify({ cwd: root, session_id: "proof", tool_name: "Edit", tool_input: { file_path: path.join(root, "source.ts") } });
    const injected = await invokeHook(cliEntry, root, ["enforce", "pre-tool-use"], payload);
    const samples = [];
    for (let i = 0; i < 10; i++) samples.push((await invokeHook(cliEntry, root, ["enforce", "pre-tool-use"], JSON.stringify({ cwd: root, tool_name: "Bash", tool_input: { command: "ls" } }))).ms);
    samples.sort((a, b) => a - b);
    const report = { synthetic: true, sensor_validated: true, correct_change_passed: green.code === 0,
      known_bad_change_blocked: red.code === 1 && red.stdout.includes(fm.id),
      edit_context_delivered: injected.output.includes(fm.id),
      no_op_hook_ms: { samples: samples.length, median: samples[4], p95: samples[9] },
      interpretation: "Synthetic plumbing and latency check; not a customer ROI or agent-quality benchmark." };
    return { ...report, passed: report.correct_change_passed && report.known_bad_change_blocked && report.edit_context_delivered };
  } finally { await rm(root, { recursive: true, force: true }); }
}
function invokeHook(entry: string, cwd: string, args: string[], payload: string): Promise<{ output: string; ms: number }> {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const child = spawn(process.execPath, [entry, ...args], { cwd, stdio: ["pipe", "pipe", "pipe"], timeout: 15_000 });
    let output = "";
    child.stdout.on("data", c => { output += c; });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve({ output, ms: Math.round(performance.now() - start) }) : reject(new Error(`Hook exited ${code}`)));
    child.stdin.end(payload);
  });
}
