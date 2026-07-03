/**
 * Machine-local sensor evaluation ledger.
 *
 * This is a rolling diagnostic window, not an archive: appends are NDJSON and once the file grows
 * beyond 10,000 lines it is compacted to the newest 8,000. Every API in this module is best-effort;
 * telemetry must never be able to break a commit.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export type SensorEvaluationStage = "pre-commit" | "pre-push" | "ci" | "manual";
export type SensorEvaluationOutcome = "fired" | "silent" | "unrunnable";

export interface SensorEvaluation {
  at: string;
  memory_id: string;
  kind: "regex" | "shell" | "test";
  stage: SensorEvaluationStage;
  head_sha: string;
  scope_hash: string;
  outcome: SensorEvaluationOutcome;
  exit_code?: number;
  duration_ms?: number;
}

export interface SensorFlap {
  memory_id: string;
  scope_hash: string;
  previous: SensorEvaluation;
  current: SensorEvaluation;
}

export interface SensorHealth {
  memory_id: string;
  flap_count: number;
  flaps: SensorFlap[];
  quarantine_pending: boolean;
  never_fired: boolean;
  evaluation_count: number;
}

const MAX_LINES = 10_000;
const RETAINED_LINES = 8_000;
const DAY_MS = 86_400_000;

export function sensorLedgerPath(paths: HaivePaths): string {
  return path.join(paths.runtimeDir, "enforcement", "sensor-ledger.ndjson");
}

function isEvaluation(value: unknown): value is SensorEvaluation {
  if (!value || typeof value !== "object") return false;
  const v = value as Partial<SensorEvaluation>;
  return typeof v.at === "string" && typeof v.memory_id === "string" &&
    (v.kind === "regex" || v.kind === "shell" || v.kind === "test") &&
    (v.stage === "pre-commit" || v.stage === "pre-push" || v.stage === "ci" || v.stage === "manual") &&
    typeof v.head_sha === "string" && typeof v.scope_hash === "string" &&
    (v.outcome === "fired" || v.outcome === "silent" || v.outcome === "unrunnable");
}

/** Append evaluations and compact the rolling window when needed. Never throws. */
export async function appendSensorEvaluations(
  paths: HaivePaths,
  evaluations: SensorEvaluation[],
): Promise<void> {
  if (evaluations.length === 0) return;
  try {
    const file = sensorLedgerPath(paths);
    await mkdir(path.dirname(file), { recursive: true });
    await appendFile(file, evaluations.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    const raw = await readFile(file, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length > MAX_LINES) {
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, lines.slice(-RETAINED_LINES).join("\n") + "\n", "utf8");
      await rename(temp, file);
    }
  } catch {
    // Telemetry is deliberately non-blocking.
  }
}

/** Load valid ledger rows, optionally bounded by an ISO timestamp. Never throws. */
export async function loadSensorLedger(
  paths: HaivePaths,
  opts: { since?: string } = {},
): Promise<SensorEvaluation[]> {
  try {
    const file = sensorLedgerPath(paths);
    if (!existsSync(file)) return [];
    const since = opts.since ? Date.parse(opts.since) : Number.NEGATIVE_INFINITY;
    const raw = await readFile(file, "utf8");
    const out: SensorEvaluation[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isEvaluation(parsed)) continue;
        const at = Date.parse(parsed.at);
        if (!Number.isFinite(at) || at < since) continue;
        out.push(parsed);
      } catch { /* skip malformed rows */ }
    }
    return out;
  } catch {
    return [];
  }
}

/** sha256(path + NUL + content), sorted by path. Missing files are ignored; empty scope is "". */
export function computeScopeHash(root: string, scopedFiles: string[]): string {
  try {
    const files = [...new Set(scopedFiles.map((f) => f.replace(/\\/g, "/")))].sort();
    if (files.length === 0) return "";
    const hash = createHash("sha256");
    let included = 0;
    for (const rel of files) {
      const abs = path.resolve(root, rel);
      if (!existsSync(abs)) continue;
      try {
        hash.update(rel);
        hash.update("\0");
        hash.update(readFileSync(abs));
        hash.update("\0");
        included++;
      } catch { /* ignore unreadable files */ }
    }
    return included === 0 ? "" : hash.digest("hex");
  } catch {
    return "";
  }
}

/**
 * Deterministic health assessment. A flap is an adjacent fired/silent outcome change for the same
 * memory and identical scope hash inside the 30-day window. `unrunnable` rows never participate.
 */
export function assessSensorHealth(
  evaluations: SensorEvaluation[],
  now: Date = new Date(),
  opts: {
    /**
     * memory_id → ISO timestamp of the sensor's last manual promotion back to block
     * (sensor.promoted_at). Evaluations at or before it are ignored: the promotion is the
     * human's assertion that the oracle was fixed, so pre-promotion flaps must not
     * re-quarantine it.
     */
    promotedAt?: ReadonlyMap<string, string>;
  } = {},
): SensorHealth[] {
  const cutoff = now.getTime() - 30 * DAY_MS;
  const byMemory = new Map<string, SensorEvaluation[]>();
  for (const e of evaluations) {
    if (e.memory_id === "__gate__" || (e.kind !== "shell" && e.kind !== "test")) continue;
    const promotedAtIso = opts.promotedAt?.get(e.memory_id);
    if (promotedAtIso) {
      const promoted = Date.parse(promotedAtIso);
      if (Number.isFinite(promoted) && Date.parse(e.at) <= promoted) continue;
    }
    const list = byMemory.get(e.memory_id) ?? [];
    list.push(e);
    byMemory.set(e.memory_id, list);
  }
  const out: SensorHealth[] = [];
  for (const [memoryId, all] of byMemory) {
    all.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    const recent = all.filter((e) => Date.parse(e.at) >= cutoff && Date.parse(e.at) <= now.getTime());
    const byHash = new Map<string, SensorEvaluation[]>();
    for (const e of recent) {
      if (e.outcome === "unrunnable") continue;
      const list = byHash.get(e.scope_hash) ?? [];
      list.push(e);
      byHash.set(e.scope_hash, list);
    }
    const flaps: SensorFlap[] = [];
    for (const [scopeHash, rows] of byHash) {
      for (let i = 1; i < rows.length; i++) {
        const previous = rows[i - 1]!;
        const current = rows[i]!;
        if (previous.outcome !== current.outcome) {
          flaps.push({ memory_id: memoryId, scope_hash: scopeHash, previous, current });
        }
      }
    }
    flaps.sort((a, b) => Date.parse(a.current.at) - Date.parse(b.current.at));
    const runnable = all.filter((e) => e.outcome !== "unrunnable");
    const span = runnable.length > 1
      ? Date.parse(runnable[runnable.length - 1]!.at) - Date.parse(runnable[0]!.at)
      : 0;
    out.push({
      memory_id: memoryId,
      flap_count: flaps.length,
      flaps,
      quarantine_pending: flaps.length >= 2,
      never_fired: runnable.length >= 20 && span >= 30 * DAY_MS && runnable.every((e) => e.outcome === "silent"),
      evaluation_count: runnable.length,
    });
  }
  return out.sort((a, b) => a.memory_id.localeCompare(b.memory_id));
}

/** Build the promoted_at map for {@link assessSensorHealth} from memory frontmatters. */
export function sensorPromotedAtMap(
  frontmatters: Iterable<{ id: string; sensor?: { promoted_at?: string } | null }>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const fm of frontmatters) {
    if (fm.sensor?.promoted_at) out.set(fm.id, fm.sensor.promoted_at);
  }
  return out;
}

export function quarantineNote(at: string, flapCount: number): string {
  return `> Quarantined ${at}: oracle flapped ${flapCount}× on identical inputs — demoted block→warn. Fix the test, then re-promote with \`hivelore sensors promote <id>\`.`;
}

/** Add or replace the single quarantine note. */
export function withQuarantineNote(body: string, at: string, flapCount: number): string {
  const without = body.split("\n").filter((line) => !line.startsWith("> Quarantined ")).join("\n").trimEnd();
  return `${without}\n\n${quarantineNote(at, flapCount)}\n`;
}

/** Manual promotion clears the machine-authored quarantine conclusion. */
export function withoutQuarantineNote(body: string): string {
  return body.split("\n").filter((line) => !line.startsWith("> Quarantined ")).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}
