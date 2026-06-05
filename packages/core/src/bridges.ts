/**
 * Native bridge generator — produces agent-harness-specific config files
 * from the hAIve corpus (validated memories + block sensors).
 *
 * One pure formatter per target; no I/O.
 * The CLI command (cli/commands/bridges.ts) handles file writes and
 * idempotent marker-based updates.
 *
 * Exposed for Lot A (init.ts): call generateBridges() from haive init
 * to seed all bridges at initialisation time.
 */

import type { Memory } from "./types.js";

// ── Target registry ────────────────────────────────────────────────────────

export type BridgeTarget =
  | "claude"    // CLAUDE.md
  | "cursor"    // .cursor/rules/haive-memories.mdc
  | "cline"     // .clinerules
  | "windsurf"  // .windsurfrules
  | "continue"  // .continuerules
  | "cody"      // .sourcegraph/cody-rules.md
  | "zed"       // .rules
  | "roo"       // .roo/rules/haive.md
  | "gemini"    // GEMINI.md
  | "aider"     // CONVENTIONS.md
  | "agents"    // AGENTS.md
  | "copilot";  // .github/copilot-instructions.md

/** Canonical relative path from project root for each target. */
export const BRIDGE_TARGET_PATH: Record<BridgeTarget, string> = {
  claude:   "CLAUDE.md",
  cursor:   ".cursor/rules/haive-memories.mdc",
  cline:    ".clinerules",
  windsurf: ".windsurfrules",
  continue: ".continuerules",
  cody:     ".sourcegraph/cody-rules.md",
  zed:      ".rules",
  roo:      ".roo/rules/haive.md",
  gemini:   "GEMINI.md",
  aider:    "CONVENTIONS.md",
  agents:   "AGENTS.md",
  copilot:  ".github/copilot-instructions.md",
};

export const BRIDGE_TARGETS: BridgeTarget[] = Object.keys(BRIDGE_TARGET_PATH) as BridgeTarget[];

// ── Data types ─────────────────────────────────────────────────────────────

/**
 * Condensed sensor shape for bridge injection.
 * Callers extract this from Memory.frontmatter.sensor — no sensor-module import needed.
 */
export interface BridgeSensor {
  id: string;
  severity: "block" | "warn";
  message: string;
  /** Regex pattern, present when sensor.kind === "regex". */
  pattern?: string;
  /** Scoped file paths (sensor.paths ?? anchor.paths). */
  paths: string[];
}

export interface BridgeMemoryEntry {
  id: string;
  scope: string;
  type: string;
  summary: string;
  /** Anchor paths the memory applies to (for path-scoped display / Cursor globs). */
  paths: string[];
}

export interface GenerateBridgesOptions {
  /** Max memories to inject per bridge (default: 8). */
  maxMemories?: number;
  /** Restrict generation to these targets. Defaults to all BRIDGE_TARGETS. */
  targets?: BridgeTarget[];
}

export interface BridgeFileOutput {
  target: BridgeTarget;
  /** Relative path from project root. */
  path: string;
  content: string;
}

// ── Idempotency markers ────────────────────────────────────────────────────

export const BRIDGE_MARKERS = {
  bridgeStart: "<!-- haive:bridge-start -->",
  bridgeEnd:   "<!-- haive:bridge-end -->",
  memoriesStart: "<!-- haive:memories-start -->",
  memoriesEnd:   "<!-- haive:memories-end -->",
  sensorsStart:  "<!-- haive:sensors-start -->",
  sensorsEnd:    "<!-- haive:sensors-end -->",
} as const;

// ── Pure helpers ───────────────────────────────────────────────────────────

/** First meaningful line of a memory body, condensed for bridge display. */
export function bridgeMemorySummary(body: string): string {
  const firstLine = body
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0) ?? "";
  const oneLine = firstLine.replace(/\s+/g, " ");
  return oneLine.length > 140 ? oneLine.slice(0, 137) + "…" : oneLine;
}

/**
 * Filter and rank memories + sensors for bridge injection.
 * Pure — callers load data; this function does not read files.
 */
export function prepareBridgeData(
  memories: Memory[],
  sensors: BridgeSensor[],
  opts?: Pick<GenerateBridgesOptions, "maxMemories">,
): { topMemories: BridgeMemoryEntry[]; blockSensors: BridgeSensor[] } {
  const max = opts?.maxMemories ?? 8;

  const topMemories: BridgeMemoryEntry[] = memories
    .filter((m) => {
      const s = m.frontmatter.status;
      if (m.frontmatter.type === "session_recap") return false;
      // Stack-pack seeds are generic background context, not repo-specific breadcrumbs.
      if (m.frontmatter.tags?.includes("stack-pack") || m.frontmatter.tags?.includes("seed")) return false;
      return s === "validated" || s === "proposed";
    })
    .sort((a, b) => {
      const score = (m: Memory): number => (m.frontmatter.status === "validated" ? 2 : 1);
      return score(b) - score(a);
    })
    .slice(0, max)
    .map((m) => ({
      id: m.frontmatter.id,
      scope: m.frontmatter.scope,
      type: m.frontmatter.type,
      summary: bridgeMemorySummary(m.body),
      paths: m.frontmatter.anchor?.paths ?? [],
    }));

  const blockSensors = sensors.filter((s) => s.severity === "block");

  return { topMemories, blockSensors };
}

// ── Block renderers ────────────────────────────────────────────────────────

function renderMemoriesBlock(topMemories: BridgeMemoryEntry[]): string {
  const lines = [
    BRIDGE_MARKERS.memoriesStart,
    "<!-- AUTO-GENERATED by haive bridges sync — do not edit between these markers -->",
    "<!-- Top memories — call get_briefing / mem_get for the full body. -->",
    "",
  ];
  if (topMemories.length === 0) {
    lines.push("_(no validated memories yet — run `haive sync` to populate)_");
  } else {
    for (const m of topMemories) {
      // Path-scoping: surface the files a lesson applies to so the agent knows
      // *when* it is relevant — the same data Cursor would express via .mdc globs.
      const scopeNote =
        m.paths.length > 0
          ? ` _(applies to: ${m.paths.slice(0, 4).join(", ")}${m.paths.length > 4 ? ", …" : ""})_`
          : "";
      lines.push(`- \`${m.id}\` (${m.scope}/${m.type}) — ${m.summary}${scopeNote}`);
    }
  }
  lines.push("", BRIDGE_MARKERS.memoriesEnd);
  return lines.join("\n");
}

function renderSensorsBlock(blockSensors: BridgeSensor[]): string {
  if (blockSensors.length === 0) return "";

  const lines = [
    BRIDGE_MARKERS.sensorsStart,
    "<!-- AUTO-GENERATED by haive bridges sync — do not edit between these markers -->",
    "",
    "## Hard rules — hAIve block sensors",
    "",
    "The patterns below are blocked by the repo enforcement gate.",
    "Introducing them will fail the pre-commit check (`haive enforce check`).",
    "",
  ];
  for (const s of blockSensors) {
    const pathNote = s.paths.length > 0 ? ` _(applies to: ${s.paths.join(", ")})_` : "";
    lines.push(`- **${s.id}**${pathNote}: ${s.message}`);
    if (s.pattern) lines.push(`  - Pattern: \`${s.pattern}\``);
  }
  lines.push("", BRIDGE_MARKERS.sensorsEnd);
  return lines.join("\n");
}

// ── Shared preamble & formatter skeleton ──────────────────────────────────

const HAIVE_PREAMBLE =
  "<!-- Managed by hAIve. Edit OUTSIDE the haive markers only; the marked blocks are regenerated. -->\n" +
  "\n" +
  "This repo uses **[hAIve](https://github.com/Doucs91/hAIve)** for shared, enforced team context.\n" +
  "The corpus lives in `.ai/` and is the source of truth — these files are a generated mirror.\n" +
  "\n" +
  "- `.ai/project-context.md` — project overview, architecture, conventions.\n" +
  "- `.ai/memories/` — decisions, gotchas, conventions, failed attempts (personal/team/module).\n" +
  "- The blocks below are the top current memories + the hard rules enforced on commit.\n" +
  "\n" +
  "## Working through hAIve\n" +
  "\n" +
  "1. **Before editing** for a goal, call `get_briefing` (task + files/symbols) to load ranked context\n" +
  "   — or `mem_relevant_to` if project context is already loaded this session.\n" +
  "2. **When an approach fails**, call `mem_tried` right away so the next agent skips the dead end.\n" +
  "3. **Before closing** a substantive session, run the `post_task` prompt to capture what was learned.\n" +
  "4. **Before final response**, run `haive enforce finish`; fix anything it blocks before reporting done.\n" +
  "\n" +
  "If the haive MCP server is not available, tell the developer rather than silently skipping it.\n" +
  "\n" +
  "## Safety\n" +
  "\n" +
  "- If `get_briefing` returns `action_required`, surface each item to the developer (use its\n" +
  "  `developer_message`) and wait for explicit confirmation before changing any code.\n" +
  "- Never act autonomously on a cross-repo breaking change (dep bump, contract/API diff) — ask first.";

function renderMarkdownBridge(
  topMemories: BridgeMemoryEntry[],
  blockSensors: BridgeSensor[],
  title: string,
): string {
  const parts: string[] = [
    `# ${title}`,
    "",
    BRIDGE_MARKERS.bridgeStart,
    "<!-- AUTO-GENERATED by haive bridges sync — do not edit between these markers -->",
    "",
    HAIVE_PREAMBLE,
    "",
    "## Memories",
    "",
    renderMemoriesBlock(topMemories),
  ];
  const sensorsBlock = renderSensorsBlock(blockSensors);
  if (sensorsBlock) {
    parts.push("", sensorsBlock);
  }
  parts.push("", BRIDGE_MARKERS.bridgeEnd);
  return parts.join("\n") + "\n";
}

/**
 * Cursor reads `.cursor/rules/*.mdc` files, each carrying a small YAML
 * frontmatter (`description`, `globs`, `alwaysApply`). We emit an always-applied
 * rule so the shared corpus is loaded on every Cursor task — the equivalent of
 * memories.sh's "always-on" lane, but carrying our block sensors too.
 *
 * The frontmatter sits OUTSIDE the haive markers, so the CLI's idempotent
 * marker-based update never rewrites it — only the memories/sensors blocks
 * refresh on `haive bridges sync`.
 */
function renderCursorBridge(
  topMemories: BridgeMemoryEntry[],
  blockSensors: BridgeSensor[],
): string {
  const frontmatter = [
    "---",
    "description: hAIve shared memories & block sensors (auto-generated)",
    "alwaysApply: true",
    "---",
    "",
  ].join("\n");
  return frontmatter + renderMarkdownBridge(topMemories, blockSensors, "hAIve rules (Cursor)");
}

// ── Per-target formatters (pure functions) ─────────────────────────────────

type Formatter = (memories: BridgeMemoryEntry[], sensors: BridgeSensor[]) => string;

const FORMATTERS: Record<BridgeTarget, Formatter> = {
  claude:   (m, s) => renderMarkdownBridge(m, s, "CLAUDE.md — hAIve context"),
  cursor:   (m, s) => renderCursorBridge(m, s),
  cline:    (m, s) => renderMarkdownBridge(m, s, "hAIve rules (Cline)"),
  windsurf: (m, s) => renderMarkdownBridge(m, s, "hAIve rules (Windsurf)"),
  continue: (m, s) => renderMarkdownBridge(m, s, "hAIve rules (Continue)"),
  cody:     (m, s) => renderMarkdownBridge(m, s, "hAIve rules (Cody / Sourcegraph)"),
  zed:      (m, s) => renderMarkdownBridge(m, s, "hAIve rules (Zed)"),
  roo:      (m, s) => renderMarkdownBridge(m, s, "hAIve rules (Roo Code)"),
  gemini:   (m, s) => renderMarkdownBridge(m, s, "GEMINI.md — hAIve context"),
  aider:    (m, s) => renderMarkdownBridge(m, s, "CONVENTIONS.md — hAIve context (Aider)"),
  agents:   (m, s) => renderMarkdownBridge(m, s, "AGENTS.md — hAIve context"),
  copilot:  (m, s) => renderMarkdownBridge(m, s, "hAIve rules (GitHub Copilot)"),
};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate bridge file content for the requested targets.
 *
 * Pure: accepts loaded memories + sensors, returns file content strings.
 * The CLI command handles I/O and idempotent marker-based updates.
 *
 * **Lot A integration point**: call this from `haive init` to seed bridges at initialisation.
 * Signature is intentionally stable — init.ts should call:
 *   `generateBridges(memories, sensors, { targets: BRIDGE_TARGETS })`
 */
export function generateBridges(
  memories: Memory[],
  sensors: BridgeSensor[],
  opts?: GenerateBridgesOptions,
): BridgeFileOutput[] {
  const { topMemories, blockSensors } = prepareBridgeData(memories, sensors, opts);
  const targets: BridgeTarget[] = opts?.targets ?? BRIDGE_TARGETS;

  return targets.map((target) => ({
    target,
    path: BRIDGE_TARGET_PATH[target],
    content: FORMATTERS[target](topMemories, blockSensors),
  }));
}
