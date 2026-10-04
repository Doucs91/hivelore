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
  try {
    const payload = JSON.parse(raw);
    const command = String(payload.tool_input?.command ?? "").trim();
    // Conservative allowlist: compound commands, substitutions and redirects take the full path.
    const readOnly = payload.tool_name === "Bash" && !/[;&|><`\n]|\$\(|--(?:output|pre|exec|ext-diff|textconv|open|pager)\b/.test(command) &&
      (/^(pwd|ls|cat|head|tail|rg|grep)\b/.test(command) || /^git\s+(status|ls-files)\b/.test(command));
    const response = payload.tool_response;
    const exitCode = typeof response === "object" ? (response?.exit_code ?? response?.exitCode ?? 0) : 0;
    const failed = response?.error || (exitCode !== 0 && !(exitCode === 1 && /^(rg|grep)\b/.test(command))) ||
      /ENOENT|EACCES|command not found|No such file|^Error/m.test(typeof response === "string" ? response : "");
    if (readOnly && !failed) process.exit(0);
    (globalThis as { hiveloreHookPayload?: string }).hiveloreHookPayload = raw;
  } catch { process.exit(0); }
}
await import("./index.js");

export {};
