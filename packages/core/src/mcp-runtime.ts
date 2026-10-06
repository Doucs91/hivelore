import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { HaivePaths } from "./paths.js";
export interface McpRuntimeInstance { version: string; pid: number; started_at?: string; }
/** Include the legacy marker; new diagnostic processes must not hide an older live server. */
export async function readMcpRuntimeInstances(paths: HaivePaths, alive: (pid: number) => boolean = pid => {
  try { process.kill(pid, 0); return true; } catch { return false; }
}): Promise<McpRuntimeInstance[]> {
  const dir = path.join(paths.runtimeDir, "mcp-servers");
  const files = (await readdir(dir).catch(() => [])).filter(f => /^\d+\.json$/.test(f)).map(f => path.join(dir, f));
  files.unshift(path.join(paths.runtimeDir, "mcp-server.json"));
  const found = new Map<number, McpRuntimeInstance>();
  for (const file of files) {
    try {
      const m = JSON.parse(await readFile(file, "utf8"));
      if (Number.isInteger(m.pid) && m.pid > 0 && typeof m.version === "string" && alive(m.pid)) found.set(m.pid, m);
    } catch { /* Absent or interrupted receipt is not proof of a running server. */ }
  }
  return [...found.values()];
}
