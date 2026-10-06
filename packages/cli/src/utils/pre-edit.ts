import path from "node:path";
import { existsSync } from "node:fs";
import { findProjectRoot, resolveHaivePaths, loadConfig } from "@hivelore/core";
import { injectFileContext } from "./file-context.js";
export interface HookPayload { cwd?: string; session_id?: string; tool_name?: string; tool_input?: Record<string, unknown>; }
function resolveRoot(dir: string | undefined, payload: HookPayload): string | null {
  try { return findProjectRoot(dir ?? payload.cwd); } catch { return null; }
}
export async function runPreEdit(payload: HookPayload, dir?: string): Promise<number> {
  const root = resolveRoot(dir, payload);
  if (!root) return 0;
  const paths = resolveHaivePaths(root);
  if (!existsSync(paths.haiveDir)) return 0;
  if (!isWriteLikeTool(payload)) return 0;

  const config = await loadConfig(paths);
  if (config.enforcement?.requireBriefingFirst === false) return 0;
  const gate = config.enforcement?.preEditGate ?? "advise";

  const targetFiles = extractToolPaths(payload, root);
  const contextText = await injectFileContext(paths, targetFiles, payload.session_id);
  if (!contextText) return 0;

  if (gate === "block") {
    // Legacy strict behaviour: block — but with the actual content and no separate command.
    // Only complete instructions are credited; pointers require an explicit full read.
    console.error(
      contextText +
      "\n\nFor fully delivered context, re-issue the same edit to proceed. Read any instruction marked NOT delivered with mem_get (using this hook session_id) " +
      "or hivelore memory get --session-id before retrying. To use advisory mode, set " +
      '`{ "enforcement": { "preEditGate": "advise" } }` in .ai/hivelore.config.json.',
    );
    return 2;
  }

  // advise (default): inject the context into the agent and ALLOW the edit — zero round-trip.
  // Commit-time decision-coverage + CI enforcement remain the hard backstops.
  emitPreToolUseContext(contextText);
  return 0;
}
/** Emit a Claude Code PreToolUse hook result that injects context for the model WITHOUT blocking. */
function emitPreToolUseContext(text: string): void {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        additionalContext: text,
      },
    }),
  );
}

export function isWriteLikeTool(payload: HookPayload): boolean {
  const tool = payload.tool_name ?? "";
  if (["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(tool)) return true;
  if (tool !== "Bash") return false;
  const command = String(payload.tool_input?.["command"] ?? "");
  return /\b(rm|mv|cp|mkdir|touch|tee|sed|perl|python|node|npm|pnpm|yarn|git)\b/.test(command) ||
    />{1,2}/.test(command);
}

export function extractToolPaths(payload: HookPayload, root: string): string[] {
  const input = payload.tool_input ?? {};
  const values: unknown[] = [
    input["file_path"],
    input["path"],
    input["notebook_path"],
  ];
  if (Array.isArray(input["file_paths"])) values.push(...input["file_paths"]);
  if (Array.isArray(input["files"])) values.push(...input["files"]);

  if (payload.tool_name === "MultiEdit" && Array.isArray(input["edits"])) {
    for (const edit of input["edits"]) {
      if (edit && typeof edit === "object" && "file_path" in edit) {
        values.push((edit as { file_path?: unknown }).file_path);
      }
    }
  }

  const out = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    out.add(normalizeToolPath(value, root));
  }
  return [...out].filter(Boolean).sort();
}

function normalizeToolPath(file: string, root: string): string {
  const normalized = file.replace(/\\/g, "/");
  if (!path.isAbsolute(normalized)) return normalized.replace(/^\.\//, "");
  return path.relative(root, normalized).replace(/\\/g, "/");
}
