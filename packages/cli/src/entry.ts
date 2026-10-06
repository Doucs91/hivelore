/** Cheap hook admission before importing the CLI/MCP/AST dependency graph. */
const args = process.argv.slice(2);
const hook = args[0] === "observe" || (args[0] === "enforce" && args[1] === "pre-tool-use");
if (hook && !args.some(arg => arg === "--help" || arg === "-h")) {
  const raw = await new Promise<string>((resolve) => {
    if (process.stdin.isTTY) { resolve(""); return; }
    let input = "";
    const finish = () => { clearTimeout(timer); process.stdin.pause(); resolve(input); };
    const timer = setTimeout(finish, 2000);
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { input += chunk; if (input.length > 256 * 1024) { input = ""; finish(); } });
    process.stdin.once("end", finish);
    process.stdin.once("error", finish);
  });
  let payload;
  try { payload = JSON.parse(raw); } catch { process.exit(0); }
  try {
    const command = String(payload.tool_input?.command ?? "").trim();
    // Conservative allowlist: compound commands, substitutions and redirects take the full path.
    const readOnly = payload.tool_name === "Bash" && !/[;&|><`\n]|\$\(|--(?:output|pre|exec|ext-diff|textconv|open|pager)\b/.test(command) &&
      (/^(pwd|ls|cat|head|tail|rg|grep)\b/.test(command) || /^git\s+(status|ls-files)\b/.test(command));
    const response = payload.tool_response;
    const exitCode = typeof response === "object" ? (response?.exit_code ?? response?.exitCode ?? 0) : 0;
    const failed = response?.error || (exitCode !== 0 && !(exitCode === 1 && /^(rg|grep)\b/.test(command))) ||
      /ENOENT|EACCES|command not found|No such file|^Error/m.test(typeof response === "string" ? response : "");
    if (readOnly && !failed) process.exit(0);
    if (args[0] === "enforce" && args[1] === "pre-tool-use") {
      // Read/search tools and shell calls without explicit file targets cannot inject edit context.
      const input = payload.tool_input ?? {};
      const hasPaths = [input.file_path, input.path, input.notebook_path].some(v => typeof v === "string" && v.trim()) ||
        [input.file_paths, input.files, input.edits].some(v => Array.isArray(v) && v.length);
      if (!["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"].includes(payload.tool_name) || !hasPaths) process.exit(0);
      const dirIndex = args.findIndex(arg => arg === "--dir" || arg === "-d");
      const dir = dirIndex >= 0 ? args[dirIndex + 1] : args.find(arg => arg.startsWith("--dir="))?.slice(6);
      const { runPreEdit } = await import("./utils/pre-edit.js");
      process.exitCode = await runPreEdit(payload, dir);
      // Do not import the full CLI once the hook is handled.
      process.exit(process.exitCode ?? 0);
    }
    (globalThis as { hiveloreHookPayload?: string }).hiveloreHookPayload = raw;
  } catch (error) {
    console.error(`Hivelore hook failed: ${(error as Error).message}`);
    process.exit(2);
  }
}
await import("./index.js");

export {};
