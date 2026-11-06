/**
 * The harness report — "is Hivelore preventing mistakes, or performing ceremony?"
 *
 * Field report #12 §4.3: `.ai/.runtime/knowledge-outcomes.jsonl` existed and nobody ever saw it, the
 * gate "never failed" without anyone being able to tell prevention from ritual, and every unused
 * surface still cost schema, docs and prompt space. This report shows OUTCOMES, case by case, and
 * names what to delete next:
 *
 *   - each sensor: evaluations, fires, catches, live waivers, last hit — and the ones never evaluated;
 *   - the most-surfaced memories, and whether anyone reported applying or rejecting them;
 *   - validated memories never surfaced in the window — archive candidates;
 *   - anchors that no longer exist;
 *   - decisions whose `expires_when` date has passed.
 *
 * Pure: the caller loads the data. No inference of time saved or bugs prevented — counts only.
 */
import type { LoadedMemory } from "./loader.js";
import type { KnowledgeOutcome } from "./outcomes.js";
import type { PreventionEvent } from "./prevention.js";
import type { SensorEvaluation } from "./sensor-ledger.js";

export interface HarnessReportInput {
  memories: LoadedMemory[];
  ledger: SensorEvaluation[];
  catches: PreventionEvent[];
  outcomes: KnowledgeOutcome[];
  /** memory id → live `hivelore:allow` waiver count in the tracked tree. */
  waivers: Map<string, number>;
  /** Does this project-relative anchor path exist? (globs are never checked) */
  anchorExists: (anchor: string) => boolean;
  windowDays?: number;
  now?: Date;
}

export interface HarnessSensorRow {
  id: string;
  kind: string;
  severity: string;
  evaluations: number;
  fired: number;
  catches: number;
  waivers: number;
  last_hit: string | null;
  verdict: "catching" | "armed-silent" | "never-evaluated" | "waived-more-than-caught";
}

export interface HarnessMemoryRow {
  id: string;
  type: string;
  exposed: number;
  applied: number;
  rejected: number;
  verdict: "followed" | "rejected" | "unconfirmed";
}

export interface HarnessReport {
  window_days: number;
  generated_at: string;
  sensors: HarnessSensorRow[];
  most_surfaced: HarnessMemoryRow[];
  never_surfaced: Array<{ id: string; type: string; age_days: number }>;
  dangling_anchors: Array<{ id: string; missing: string[] }>;
  expired_decisions: Array<{ id: string; expires_when: string }>;
  totals: {
    memories: number;
    sensors: number;
    catches_in_window: number;
    exposures_in_window: number;
    applied_in_window: number;
  };
  interpretation: string;
}

const DAY_MS = 86_400_000;

function isGlob(p: string): boolean {
  return /[*?[\]{}]/.test(p);
}

export function buildHarnessReport(input: HarnessReportInput): HarnessReport {
  const now = input.now ?? new Date();
  const windowDays = input.windowDays ?? 60;
  const since = now.getTime() - windowDays * DAY_MS;
  const inWindow = (iso: string): boolean => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && t >= since && t <= now.getTime() + DAY_MS;
  };

  const live = input.memories.filter(({ memory }) =>
    !["rejected", "deprecated"].includes(memory.frontmatter.status) && memory.frontmatter.type !== "session_recap");

  // ── Sensors ──
  const sensors: HarnessSensorRow[] = [];
  for (const { memory } of live) {
    const sensor = memory.frontmatter.sensor;
    if (!sensor) continue;
    const id = memory.frontmatter.id;
    const evals = input.ledger.filter((e) => e.memory_id === id && inWindow(e.at));
    const fired = evals.filter((e) => e.outcome === "fired");
    const catches = input.catches.filter((c) => c.id === id && inWindow(c.at));
    const hits = [...fired.map((e) => e.at), ...catches.map((c) => c.at)].sort();
    const waivers = input.waivers.get(id) ?? 0;
    const verdict: HarnessSensorRow["verdict"] =
      waivers > 0 && waivers > catches.length ? "waived-more-than-caught"
        : catches.length > 0 || fired.length > 0 ? "catching"
          : evals.length > 0 ? "armed-silent"
            : "never-evaluated";
    sensors.push({
      id,
      kind: sensor.kind,
      severity: sensor.severity,
      evaluations: evals.length,
      fired: fired.length,
      catches: catches.length,
      waivers,
      last_hit: hits.length ? hits[hits.length - 1]! : sensor.last_fired ?? null,
      verdict,
    });
  }
  const verdictOrder = { "waived-more-than-caught": 0, catching: 1, "never-evaluated": 2, "armed-silent": 3 } as const;
  sensors.sort((a, b) => verdictOrder[a.verdict] - verdictOrder[b.verdict] || b.catches - a.catches || a.id.localeCompare(b.id));

  // ── Surfacing vs. follow-through ──
  const windowOutcomes = input.outcomes.filter((o) => inWindow(o.at));
  const byMemory = new Map<string, { exposed: number; applied: number; rejected: number }>();
  for (const o of windowOutcomes) {
    const row = byMemory.get(o.id) ?? { exposed: 0, applied: 0, rejected: 0 };
    if (o.kind === "exposed") row.exposed++;
    else if (o.kind === "applied" || o.kind === "verified" || o.kind === "corrected") row.applied++;
    else if (o.kind === "rejected") row.rejected++;
    byMemory.set(o.id, row);
  }
  const typeOf = new Map(live.map(({ memory }) => [memory.frontmatter.id, memory.frontmatter.type]));
  const mostSurfaced: HarnessMemoryRow[] = [...byMemory.entries()]
    .filter(([id, row]) => typeOf.has(id) && row.exposed > 0)
    .sort((a, b) => b[1].exposed - a[1].exposed)
    .slice(0, 10)
    .map(([id, row]) => ({
      id,
      type: typeOf.get(id)!,
      ...row,
      verdict: row.rejected > row.applied ? "rejected" : row.applied > 0 ? "followed" : "unconfirmed",
    }));

  // ── Archive candidates: validated knowledge nobody has been shown in the window ──
  const neverSurfaced = live
    .filter(({ memory }) => {
      const fm = memory.frontmatter;
      if (fm.status !== "validated" || fm.sensor) return false; // sensors earn their keep at the gate
      const created = Date.parse(fm.created_at);
      if (!Number.isFinite(created) || created > since) return false;
      return !byMemory.get(fm.id)?.exposed;
    })
    .map(({ memory }) => ({
      id: memory.frontmatter.id,
      type: memory.frontmatter.type,
      age_days: Math.floor((now.getTime() - Date.parse(memory.frontmatter.created_at)) / DAY_MS),
    }))
    .sort((a, b) => b.age_days - a.age_days);

  // ── Dangling anchors ──
  const dangling = live
    .map(({ memory }) => ({
      id: memory.frontmatter.id,
      missing: memory.frontmatter.anchor.paths.filter((p) => !isGlob(p) && !input.anchorExists(p)),
    }))
    .filter((row) => row.missing.length > 0);

  // ── Expired decisions ──
  const expired = live
    .filter(({ memory }) => {
      const when = memory.frontmatter.expires_when;
      if (!when) return false;
      const t = Date.parse(when);
      return Number.isFinite(t) && t < now.getTime();
    })
    .map(({ memory }) => ({ id: memory.frontmatter.id, expires_when: memory.frontmatter.expires_when! }));

  return {
    window_days: windowDays,
    generated_at: now.toISOString(),
    sensors,
    most_surfaced: mostSurfaced,
    never_surfaced: neverSurfaced,
    dangling_anchors: dangling,
    expired_decisions: expired,
    totals: {
      memories: live.length,
      sensors: sensors.length,
      catches_in_window: input.catches.filter((c) => inWindow(c.at)).length,
      exposures_in_window: windowOutcomes.filter((o) => o.kind === "exposed").length,
      applied_in_window: windowOutcomes.filter((o) => o.kind !== "exposed" && o.kind !== "rejected").length,
    },
    interpretation:
      "Counts only. A catch is a commit the gate refused on a documented lesson; an exposure is delivery, " +
      "not usefulness; 'followed' needs an explicit applied/verified report. Nothing here infers time saved.",
  };
}

/** Plain-text rendering, most actionable section first. */
export function renderHarnessReport(report: HarnessReport): string {
  const lines: string[] = [];
  const t = report.totals;
  lines.push(`Hivelore harness report — last ${report.window_days} days`);
  lines.push(
    `${t.sensors} sensor(s), ${t.catches_in_window} catch(es) · ${t.memories} memories, ` +
    `${t.exposures_in_window} exposure(s), ${t.applied_in_window} reported application(s)`,
  );

  const section = (title: string, rows: string[], empty: string): void => {
    lines.push("", title);
    if (rows.length === 0) lines.push(`  ${empty}`);
    else for (const row of rows) lines.push(`  ${row}`);
  };

  section(
    "Sensors (the gate)",
    report.sensors.map((s) =>
      `${s.verdict.padEnd(24)} ${s.id} [${s.kind}/${s.severity}] — ${s.catches} catch(es), ${s.fired} fire(s) in ${s.evaluations} run(s)` +
      (s.waivers ? `, ${s.waivers} waiver(s)` : "") + (s.last_hit ? `, last hit ${s.last_hit.slice(0, 10)}` : "")),
    "No sensors yet — a lesson becomes enforceable with `hivelore sensors propose <id>`.",
  );
  section(
    "Most surfaced memories",
    report.most_surfaced.map((m) => `${m.verdict.padEnd(12)} ${m.id} (${m.type}) — shown ${m.exposed}×, applied ${m.applied}, rejected ${m.rejected}`),
    "Nothing surfaced in the window.",
  );
  section(
    `Never surfaced in ${report.window_days} days — archive candidates`,
    report.never_surfaced.slice(0, 15).map((m) => `${m.id} (${m.type}, ${m.age_days}d old)`)
      .concat(report.never_surfaced.length > 15 ? [`…and ${report.never_surfaced.length - 15} more (--json for all)`] : []),
    "None.",
  );
  section(
    "Anchors that no longer exist",
    report.dangling_anchors.slice(0, 15).map((d) => `${d.id}: ${d.missing.join(", ")}`),
    "None.",
  );
  section(
    "Decisions past their expiry date",
    report.expired_decisions.map((d) => `${d.id} (expired ${d.expires_when.slice(0, 10)}) — revisit, then update or archive`),
    "None.",
  );
  lines.push("", report.interpretation);
  return lines.join("\n");
}
