import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export type OutcomeKind = "exposed" | "applied" | "rejected" | "corrected" | "verified";
export interface KnowledgeOutcome {
  at: string;
  id: string;
  kind: OutcomeKind;
  session_id?: string;
  files?: string[];
  reference?: string;
  source: "hook" | "mcp" | "cli";
  evidence: "observed" | "reported";
}
const file = (paths: HaivePaths) => path.join(paths.runtimeDir, "knowledge-outcomes.jsonl");
/** Append-only local events: no source contents, prompts, environment, or automatic corpus edits. */
export async function recordKnowledgeOutcome(paths: HaivePaths, event: Omit<KnowledgeOutcome, "at">): Promise<void> {
  await mkdir(paths.runtimeDir, { recursive: true });
  await appendFile(file(paths), JSON.stringify({ ...event, at: new Date().toISOString() }) + "\n");
}
export async function loadKnowledgeOutcomes(paths: HaivePaths): Promise<KnowledgeOutcome[]> {
  const raw = await readFile(file(paths), "utf8").catch(() => "");
  return raw.split("\n").flatMap(line => {
    try {
      const e = JSON.parse(line) as KnowledgeOutcome;
      return e.id && Number.isFinite(Date.parse(e.at)) && ["exposed", "applied", "rejected", "corrected", "verified"].includes(e.kind) ? [e] : [];
    } catch { return []; }
  });
}
export function summarizeKnowledgeOutcomes(events: KnowledgeOutcome[]) {
  const byMemory: Record<string, Record<OutcomeKind, number>> = Object.create(null);
  for (const event of events) {
    const counts = byMemory[event.id] ??= { exposed: 0, applied: 0, rejected: 0, corrected: 0, verified: 0 };
    counts[event.kind]++;
  }
  return { events: events.length, by_memory: byMemory,
    interpretation: "Exposures are delivery, not usefulness. Applied/corrected/verified feedback is explicitly reported; sensor catches are separate. No time savings or prevented bugs inferred." };
}
