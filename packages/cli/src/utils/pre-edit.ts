import path from "node:path";
import { existsSync } from "node:fs";
import { distinctiveEditTokens, findProjectRoot, resolveHaivePaths, loadConfig } from "@hivelore/core";
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
  const contextText = await injectFileContext(paths, targetFiles, payload.session_id, { editKeys: editKeys(payload) });
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
/** The text an edit introduces or replaces — the config keys a doc may warn about. */
export function editKeys(payload: HookPayload): string[] {
  const input = payload.tool_input ?? {};
  const parts: string[] = [];
  for (const key of ["new_string", "old_string", "content", "command"]) {
    const value = input[key];
    if (typeof value === "string") parts.push(value.slice(0, 4000));
  }
  if (Array.isArray(input["edits"])) {
    for (const edit of input["edits"] as Array<Record<string, unknown>>) {
      for (const key of ["new_string", "old_string"]) if (typeof edit?.[key] === "string") parts.push((edit[key] as string).slice(0, 2000));
    }
  }
  return parts.length ? distinctiveEditTokens(parts.join("\n")) : [];
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
  return bashCommandMayWrite(command);
}

/**
 * Could this shell command modify files? Conservative on writers, strict on readers: `git status`,
 * `git diff`, `git log`, `ls`, `cat`, `grep` and `2>/dev/null` redirections are reads, and a reminder
 * after a read is noise (field report #9 §3).
 */
export function bashCommandMayWrite(command: string): boolean {
  const withoutNullRedirects = command.replace(/\d?>{1,2}\s*\/dev\/null/g, "").replace(/\d>&\d/g, "");
  if (/(^|[^<>])>{1,2}(?!&)/.test(withoutNullRedirects)) return true;
  if (/\b(rm|mv|cp|mkdir|touch|tee|perl|python3?|node|npm|pnpm|yarn|npx|patch|truncate|ln|chmod|install)\b/.test(withoutNullRedirects)) return true;
  if (/\bsed\b[^|;&]*\s-i/.test(withoutNullRedirects)) return true;
  const git = withoutNullRedirects.match(/\bgit\s+(?:-C\s+\S+\s+)?([a-z-]+)/g) ?? [];
  const GIT_READS = new Set(["status", "diff", "log", "show", "branch", "rev-parse", "ls-files", "blame", "remote", "fetch", "describe", "shortlog", "grep", "config"]);
  return git.some((match) => !GIT_READS.has(match.trim().split(/\s+/).pop()!));
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
