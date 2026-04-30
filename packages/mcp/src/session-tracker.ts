/**
 * Auto-session tracker for autopilot mode.
 *
 * Tracks which MCP tools were called during a server session.
 * On SIGTERM/SIGINT (i.e. when the AI client closes), automatically
 * saves a session recap via mem_session_end — no human action needed.
 */
import { loadConfig, type HaiveConfig } from "@hiveai/core";
import type { HaiveContext } from "./context.js";
import { memSessionEnd } from "./tools/mem-session-end.js";

export interface SessionEvent {
  tool: string;
  at: string; // ISO timestamp
  /** Partial input snapshot (non-sensitive fields only) */
  summary?: string;
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
    this.events.push({ tool, at: new Date().toISOString(), summary });
  }

  private registerShutdownHandler(): void {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;

    const save = async (): Promise<void> => {
      // Only save if something actually happened this session
      const writingTools = this.events.filter((e) =>
        ["mem_save", "mem_tried", "mem_observe", "mem_update", "bootstrap_project_save"].includes(e.tool),
      );
      const totalCalls = this.events.length;

      if (totalCalls === 0) return;

      const toolSummary = summarizeTools(this.events);
      const filesSet = new Set<string>();
      for (const e of this.events) {
        if (e.summary) {
          // Extract any file paths mentioned in summaries
          const matches = e.summary.match(/[^\s"',]+\.[a-zA-Z]{1,6}/g) ?? [];
          for (const m of matches) filesSet.add(m);
        }
      }

      try {
        await memSessionEnd(
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
      } catch {
        // Non-fatal — never block process exit
      }
    };

    process.once("SIGTERM", () => { void save().finally(() => process.exit(0)); });
    process.once("SIGINT", () => { void save().finally(() => process.exit(0)); });
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
