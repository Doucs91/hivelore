import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { Command } from "commander";
import {
  findProjectRoot,
  hasRecentBriefingMarker,
  resolveBriefingBudget,
  resolveHaivePaths,
  writeBriefingMarker,
} from "@hiveai/core";
import { getBriefing } from "@hiveai/mcp";

const MAX_STDIN_BYTES = 256 * 1024;

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
}

export function registerEnforce(program: Command): void {
  const enforce = program
    .command("enforce")
    .description("Agent enforcement helpers used by hAIve-installed hooks.");

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

      await writeBriefingMarker(paths, {
        sessionId,
        task,
        source: opts.source ?? "claude-session-start",
      });

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
