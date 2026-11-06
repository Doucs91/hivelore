/**
 * Command guards — rules about what an agent RUNS, enforced before it runs.
 *
 * "Never run `npm publish`", "never `git push --force` to main", "never `git push --tags`": instruction
 * files are full of these, and a study of public CLAUDE.md files found almost none backed by a
 * control. A `kind: "command"` sensor holds a regex over the shell command; the Claude Code PreToolUse
 * hook denies a matching Bash call (block) or warns (warn). Pure: no I/O.
 *
 * Text that only QUOTES a command is not running it: heredoc bodies, commit/PR messages and echo/printf
 * arguments are removed before matching, so `git commit -m "never npm publish"` passes while
 * `bash -c "npm publish"` is still caught.
 */
import { isRetiredMemory } from "./memory-lifecycle.js";
import type { Memory } from "./types.js";

export interface CommandGuardHit {
  memory_id: string;
  message: string;
  severity: "warn" | "block";
  /** The part of the command that matched. */
  matched: string;
  incident?: string;
}

const QUOTED = String.raw`("(?:[^"\\]|\\.)*"|'[^']*')`;
const HEREDOC = /<<-?\s*(['"]?)([A-Za-z_][\w-]*)\1[^\n]*\n[\s\S]*?\n\s*\2\b/g;
const MESSAGE_ARG = new RegExp(String.raw`(\s(?:-m|--message|--body|--notes|--title|--description|--subject|-t))\s+${QUOTED}`, "g");
const ECHO_ARG = new RegExp(String.raw`\b(echo|printf)\s+${QUOTED}`, "g");

/** The command with quoted-only text removed — what the shell would actually execute. */
export function commandTextForGuards(command: string): string {
  return command
    .replace(HEREDOC, "<<HEREDOC")
    .replace(MESSAGE_ARG, "$1 ''")
    .replace(ECHO_ARG, "$1 ''");
}

export function matchCommandGuards(command: string, memories: Memory[]): CommandGuardHit[] {
  const text = commandTextForGuards(command);
  if (!text.trim()) return [];
  const hits: CommandGuardHit[] = [];
  for (const memory of memories) {
    const fm = memory.frontmatter;
    const sensor = fm.sensor;
    if (!sensor || sensor.kind !== "command" || !sensor.pattern) continue;
    if (fm.status !== "validated" || isRetiredMemory(fm, memory.body)) continue;
    let re: RegExp;
    try {
      re = new RegExp(sensor.pattern, (sensor.flags ?? "").replace(/[gy]/g, ""));
    } catch {
      continue;
    }
    const match = re.exec(text);
    if (!match) continue;
    hits.push({
      memory_id: fm.id,
      message: sensor.message,
      severity: sensor.severity,
      matched: match[0],
      ...(sensor.incident ? { incident: sensor.incident } : {}),
    });
  }
  return hits.sort((a, b) => Number(b.severity === "block") - Number(a.severity === "block"));
}

/** A regex for a literal command: tokens joined by flexible whitespace, anchored on word boundaries. */
export function commandPattern(command: string): string {
  const tokens = command.trim().split(/\s+/).filter(Boolean)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (tokens.length === 0) return "";
  return `(?<![\\w-])${tokens.join("\\s+")}(?![\\w-])`;
}
