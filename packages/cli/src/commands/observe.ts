/**
 * `haive observe` — passive-capture endpoint for Claude Code's PostToolUse hook.
 *
 * Reads a single JSON payload on stdin (Claude Code's hook protocol) and appends
 * a compact observation record to `.ai/.cache/observations.jsonl`. The session-end
 * step later distills these records into proposed memories.
 *
 * Critical properties:
 *   - exit 0 ALWAYS (a hook that errors interrupts the user's flow)
 *   - bounded I/O (caps stdin read; no LLM call; no network)
 *   - tolerant to missing .ai/ (silently no-op if haive isn't initialized here)
 */
import { appendFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProjectRoot, resolveHaivePaths } from "@hiveai/core";

const MAX_STDIN_BYTES = 256 * 1024; // 256 KB cap
const TRUNCATE_FIELD = 800;

interface HookPayload {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown> | string;
  cwd?: string;
  session_id?: string;
}

interface Observation {
  ts: string;
  session_id?: string;
  cwd?: string;
  tool: string;
  summary: string;
  files?: string[];
}

function truncate(s: unknown, max = TRUNCATE_FIELD): string {
  if (s == null) return "";
  const str = typeof s === "string" ? s : JSON.stringify(s);
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function extractFiles(payload: HookPayload): string[] {
  const files = new Set<string>();
  const input = payload.tool_input ?? {};
  for (const k of ["file_path", "path", "notebook_path"]) {
    const v = input[k];
    if (typeof v === "string") files.add(v);
  }
  // Bash tool: try to spot file-ish args
  const cmd = input["command"];
  if (typeof cmd === "string") {
    const matches = cmd.match(/[\w./-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|kt|swift|rb|php|cs|cpp|c|h|md|json|yml|yaml)\b/g);
    if (matches) for (const m of matches) files.add(m);
  }
  return [...files].slice(0, 8);
}

function buildSummary(payload: HookPayload): string {
  const tool = payload.tool_name ?? "?";
  const input = payload.tool_input ?? {};
  if (tool === "Bash") return `Bash: ${truncate(input["command"], 200)}`;
  if (tool === "Edit") return `Edit ${truncate(input["file_path"], 200)}`;
  if (tool === "Write") return `Write ${truncate(input["file_path"], 200)}`;
  return `${tool}: ${truncate(input, 200)}`;
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
    setTimeout(finish, 2000); // hard cap so a stuck hook never blocks Claude
  });
}

export function registerObserve(program: Command): void {
  program
    .command("observe")
    .description(
      "Passive-capture endpoint for Claude Code PostToolUse hooks.\n\n" +
      "  Reads a JSON payload on stdin and appends an observation record to\n" +
      "  .ai/.cache/observations.jsonl. Always exits 0; never blocks the agent.\n" +
      "  Wired up automatically by `haive install-hooks claude`.",
    )
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: { dir?: string }) => {
      try {
        const raw = await readStdin(MAX_STDIN_BYTES);
        if (!raw.trim()) return;

        let payload: HookPayload;
        try {
          payload = JSON.parse(raw) as HookPayload;
        } catch {
          return; // malformed payload — silently no-op
        }

        const root = (() => {
          try { return findProjectRoot(opts.dir ?? payload.cwd); } catch { return null; }
        })();
        if (!root) return;

        const paths = resolveHaivePaths(root);
        if (!existsSync(paths.haiveDir)) return; // not a haive project

        const observation: Observation = {
          ts: new Date().toISOString(),
          session_id: payload.session_id,
          cwd: payload.cwd,
          tool: payload.tool_name ?? "?",
          summary: buildSummary(payload),
          files: extractFiles(payload),
        };

        const cacheDir = path.join(paths.haiveDir, ".cache");
        await mkdir(cacheDir, { recursive: true });
        await appendFile(
          path.join(cacheDir, "observations.jsonl"),
          JSON.stringify(observation) + "\n",
          "utf8",
        );
      } catch {
        // Hooks must never break the user's flow — swallow everything.
      }
    });
}
