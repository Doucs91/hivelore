import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadPreventionEvents, type PreventionEvent } from "./prevention.js";
import type { SensorEvaluation } from "./sensor-ledger.js";
import type { HaivePaths } from "./paths.js";

export type OutcomeKind = "exposed" | "applied" | "rejected" | "corrected" | "verified";
export interface KnowledgeOutcome {
  at: string;
  id: string;
  kind: OutcomeKind;
  session_id?: string;
  files?: string[];
  reference?: string;
  catch_id?: string;
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

/** Stable identity also works for catch logs written before correlation was introduced. */
export function preventionCatchId(event: PreventionEvent): string {
  return createHash("sha256").update(JSON.stringify([event.at, event.id, event.source, event.kind, event.stage, event.exit_code])).digest("hex").slice(0, 24);
}
export async function recordReportedOutcome(paths: HaivePaths, event: Omit<KnowledgeOutcome, "at" | "evidence">): Promise<void> {
  if (["corrected", "verified"].includes(event.kind) && !event.reference?.trim()) throw new Error("Corrected/verified feedback requires a reference.");
  if (event.catch_id) {
    const caught = (await loadPreventionEvents(paths)).find(c => preventionCatchId(c) === event.catch_id);
    if (!caught || caught.id !== event.id) throw new Error("catch_id must identify a recorded catch for this memory (stats outcomes).");
    if (event.kind === "verified" && !(await loadKnowledgeOutcomes(paths)).some(e => e.catch_id === event.catch_id && e.id === event.id && e.kind === "corrected")) {
      throw new Error("Record the correction for this catch before reporting verification.");
    }
  }
  await recordKnowledgeOutcome(paths, { ...event, evidence: "reported" });
}
/** A later silent evaluation is an observation, not proof that the reported correction caused it. */
export function correlateKnowledgeOutcomes(catches: PreventionEvent[], events: KnowledgeOutcome[], ledger: SensorEvaluation[]) {
  return catches.map(caught => {
    const catchId = preventionCatchId(caught);
    const reports = events.filter(e => e.id === caught.id && e.catch_id === catchId && Date.parse(e.at) >= Date.parse(caught.at));
    const correction = reports.find(e => e.kind === "corrected");
    const nextCatch = catches.filter(c => c.id === caught.id && Date.parse(c.at) > Date.parse(caught.at)).sort((a,b) => a.at.localeCompare(b.at))[0];
    const check = correction && caught.source === "sensor" ? ledger.filter(e => e.memory_id === caught.id && e.stage === caught.stage && e.kind === caught.kind &&
      e.outcome === "silent" && Date.parse(e.at) >= Date.parse(correction.at) && (!nextCatch || Date.parse(e.at) < Date.parse(nextCatch.at)))
      .sort((a,b) => a.at.localeCompare(b.at))[0] : undefined;
    return { catch_id: catchId, catch: caught, reports, subsequent_silent_check: check ?? null,
      status: check ? "subsequent-check-silent" : correction ? "correction-reported" : "caught",
      interpretation: "Catch/check are observed locally; corrections and verification references are reported. Causality, reference authenticity and time savings are not inferred." };
  });
}
