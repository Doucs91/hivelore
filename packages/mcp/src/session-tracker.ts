/**
 * Auto-session tracker for autopilot mode.
 *
 * Tracks which MCP tools were called during a server session.
 * On SIGTERM/SIGINT (i.e. when the AI client closes), automatically:
 *   1. Saves a session recap via mem_session_end (always)
 *   2. Writes .ai/.cache/pending-distill.json so the next get_briefing
 *      surfaces an action_required item prompting the agent to invoke
 *      post_task for a richer LLM-driven distillation.
 */
import {
  appendUsageEvent,
  appendRuntimeJournalEntry,
  loadConfig,
  type HaiveConfig,
} from "@hiveai/core";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { HaiveContext } from "./context.js";
import { memSessionEnd } from "./tools/mem-session-end.js";

export interface SessionEvent {
  tool: string;
  at: string; // ISO timestamp
  /** Partial input snapshot (non-sensitive fields only) */
  summary?: string;
}

/** Written to .ai/.cache/pending-distill.json at session end. */
export interface PendingDistill {
  session_start: string;
  session_end: string;
  total_tool_calls: number;
  /** Human-readable summary of which tools were called ("get_briefing ×3, mem_save ×2") */
  tool_summary: string;
  /** IDs of memories saved during this session */
  memories_saved: string[];
  /** True when git diff was captured and stored in git_diff field */
  git_diff_available: boolean;
  /** Snapshot of `git diff HEAD` at session close (truncated to 8 KB) */
  git_diff?: string;
  /** ID of the auto-generated session recap memory */
  recap_id?: string;
}

/** Path to the pending distill marker file. */
export function pendingDistillPath(ctx: HaiveContext): string {
  return path.join(ctx.paths.haiveDir, ".cache", "pending-distill.json");
}

export class SessionTracker {
  private events: SessionEvent[] = [];
  private startedAt: string = new Date().toISOString();
  private config: HaiveConfig | null = null;
  private ctx: HaiveContext;
  private shutdownRegistered = false;

  constructor(ctx: HaiveContext) {
    this.ctx = ctx;
  }

  async init(): Promise<void> {
    this.config = await loadConfig(this.ctx.paths);
    if (this.config.autoSessionEnd) {
      this.registerShutdownHandler();
    }
  }

  record(tool: string, summary?: string): void {
    const event: SessionEvent = { tool, at: new Date().toISOString(), summary };
    this.events.push(event);
    // Persist to .ai/.usage/tool-usage.jsonl for cross-session stats (haive stats).
    // Best-effort: never blocks the tool execution, never throws.
    void appendUsageEvent(this.ctx.paths, event);
  }

  private registerShutdownHandler(): void {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    const save = async (): Promise<void> => {
      const writingTools = this.events.filter((e) =>
        ["mem_save", "mem_tried", "mem_observe", "mem_update", "bootstrap_project_save"].includes(e.tool),
      );
      const totalCalls = this.events.length;

      if (totalCalls === 0) return;

      const toolSummary = summarizeTools(this.events);
      const filesSet = new Set<string>();
      for (const e of this.events) {
        if (e.summary) {
          const matches = e.summary.match(/[^\s"',]+\.[a-zA-Z]{1,6}/g) ?? [];
          for (const m of matches) filesSet.add(m);
        }
      }

      // ── 1. Capture git diff (best-effort, 8 KB cap) ──────────────────────
      let gitDiff: string | undefined;
      try {
        const raw = execSync("git diff HEAD", {
          cwd: this.ctx.paths.root,
          timeout: 5000,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        gitDiff = raw.slice(0, 8192) || undefined;
      } catch { /* not a git repo or no diff — ok */ }

      // ── 2. Save minimal session recap ────────────────────────────────────
      let recapId: string | undefined;
      try {
        const result = await memSessionEnd(
          {
            goal: `Auto-captured session (${totalCalls} tool call${totalCalls === 1 ? "" : "s"})`,
            accomplished: toolSummary,
            discoveries: writingTools.length > 0
              ? `${writingTools.length} memor${writingTools.length === 1 ? "y" : "ies"} saved during this session.`
              : "No new memories saved this session.",
            files_touched: [...filesSet].slice(0, 10),
            next_steps: "",
            scope: (this.config?.defaultScope as "personal" | "team") ?? "personal",
            module: undefined,
          },
          this.ctx,
        );
        recapId = result.id;
      } catch {
        // Non-fatal — never block process exit
      }

      void appendRuntimeJournalEntry(this.ctx.paths, {
        kind: "session_end",
        message: recapId
          ? `auto session close | ${toolSummary} | recap:${recapId}`
          : `auto session close | ${toolSummary}`,
        meta: {
          recap_id: recapId ?? null,
          total_tool_calls: totalCalls,
        },
      });

      // ── 3. Write pending-distill.json so next get_briefing can prompt ─────
      // Skip if the agent already ran post_task this session (no shallow recap).
      // Also skip trivial sessions (1-2 tool calls with no writes) — they don't
      // contain distillation candidates and the action_required would just be noise.
      const ranPostTask = this.events.some((e) =>
        e.tool === "mem_session_end" && !e.summary?.startsWith("Auto-captured"),
      );
      const isSubstantialSession = totalCalls >= 3 || writingTools.length > 0;
      if (!ranPostTask && isSubstantialSession && existsSync(this.ctx.paths.haiveDir)) {
        try {
          const memoriesSaved = writingTools
            .map((e) => e.summary ?? "")
            .filter(Boolean)
            .slice(0, 20);

          const payload: PendingDistill = {
            session_start: this.startedAt,
            session_end: new Date().toISOString(),
            total_tool_calls: totalCalls,
            tool_summary: toolSummary,
            memories_saved: memoriesSaved,
            git_diff_available: !!gitDiff,
            ...(gitDiff ? { git_diff: gitDiff } : {}),
            ...(recapId ? { recap_id: recapId } : {}),
          };

          const cacheDir = path.join(this.ctx.paths.haiveDir, ".cache");
          await mkdir(cacheDir, { recursive: true });
          await writeFile(
            pendingDistillPath(this.ctx),
            JSON.stringify(payload, null, 2) + "\n",
            "utf8",
          );
        } catch { /* Non-fatal */ }
      }
    };

    process.once("SIGTERM", () => { void save().finally(() => process.exit(0)); });
    process.once("SIGINT", () => { void save().finally(() => process.exit(0)); });
  }
}

/** Delete the pending distill marker if it exists. Called by mem_session_end. */
export async function clearPendingDistill(ctx: HaiveContext): Promise<void> {
  const p = pendingDistillPath(ctx);
  if (existsSync(p)) {
    try { await rm(p); } catch { /* non-fatal */ }
  }
}

function summarizeTools(events: SessionEvent[]): string {
  const counts = new Map<string, number>();
  for (const e of events) {
    counts.set(e.tool, (counts.get(e.tool) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ×${n}`)
    .join(", ");
}
