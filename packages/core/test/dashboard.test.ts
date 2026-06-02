import { describe, expect, it } from "vitest";
import { buildDashboard } from "../src/dashboard.js";
import { buildFrontmatter } from "../src/parser.js";
import { emptyUsageIndex, type UsageIndex } from "../src/usage.js";
import type { LoadedMemory } from "../src/loader.js";
import type { MemoryFrontmatter, Sensor } from "../src/types.js";

const NOW = new Date("2026-06-02T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function mem(
  overrides: Partial<MemoryFrontmatter> & { id?: string; body?: string } = {},
): LoadedMemory {
  const { body = "Some memory body.", id, ...fmOverrides } = overrides;
  const base = buildFrontmatter({
    type: fmOverrides.type ?? "gotcha",
    slug: id ?? "x",
    scope: fmOverrides.scope ?? "team",
    paths: fmOverrides.anchor?.paths ?? ["src/a.ts"],
  });
  const frontmatter: MemoryFrontmatter = { ...base, ...fmOverrides, id: id ?? base.id };
  return { memory: { frontmatter, body }, filePath: `/x/${frontmatter.id}.md` };
}

function sensor(overrides: Partial<Sensor> = {}): Sensor {
  return {
    kind: "regex",
    pattern: "eval",
    paths: ["src/a.ts"],
    message: "no eval",
    severity: "warn",
    autogen: true,
    last_fired: null,
    ...overrides,
  };
}

function usageWith(by_id: UsageIndex["by_id"]): UsageIndex {
  return { ...emptyUsageIndex(), by_id };
}

describe("buildDashboard", () => {
  it("counts inventory by scope/type/status and excludes session_recap from the policy corpus", () => {
    const memories = [
      mem({ id: "a", type: "gotcha", status: "validated" }),
      mem({ id: "b", type: "decision", scope: "personal", status: "proposed" }),
      mem({ id: "c", type: "session_recap", status: "validated" }),
    ];
    const report = buildDashboard(memories, emptyUsageIndex(), { now: NOW });
    expect(report.inventory.total).toBe(2);
    expect(report.inventory.session_recaps).toBe(1);
    expect(report.inventory.by_scope).toEqual({ team: 1, personal: 1 });
    expect(report.inventory.by_type).toEqual({ gotcha: 1, decision: 1 });
    expect(report.inventory.by_status.proposed).toBe(1);
    expect(report.corpus.memory_files).toBe(2);
    expect(report.corpus.est_tokens).toBeGreaterThan(0);
  });

  it("aggregates sensors by severity, autogen, and fired", () => {
    const memories = [
      mem({ id: "a", status: "validated", sensor: sensor({ severity: "warn", autogen: true }) }),
      mem({ id: "b", status: "validated", sensor: sensor({ severity: "block", autogen: false, last_fired: "2026-06-01T10:00:00.000Z" }) }),
      mem({ id: "c", status: "validated" }),
    ];
    const report = buildDashboard(memories, emptyUsageIndex(), { now: NOW });
    expect(report.sensors.total).toBe(2);
    expect(report.sensors.warn).toBe(1);
    expect(report.sensors.block).toBe(1);
    expect(report.sensors.autogen).toBe(1);
    expect(report.sensors.fired).toBe(1);
    expect(report.sensors.recently_fired[0]!.id).toBe("b");
  });

  it("flags anchorless validated policy memories", () => {
    const memories = [
      mem({ id: "a", type: "decision", status: "validated", anchor: { paths: [], symbols: [] } }),
      mem({ id: "b", type: "decision", status: "validated", anchor: { paths: ["src/a.ts"], symbols: [] } }),
      // glossary is not a policy type → never anchorless
      mem({ id: "c", type: "glossary", status: "validated", anchor: { paths: [], symbols: [] } }),
    ];
    const report = buildDashboard(memories, emptyUsageIndex(), { now: NOW });
    expect(report.health.anchorless).toBe(1);
  });

  it("ranks impact and surfaces applied memories as high tier", () => {
    const memories = [
      mem({ id: "applied", status: "validated" }),
      mem({ id: "ignored", status: "validated" }),
    ];
    const usage = usageWith({
      applied: { read_count: 5, last_read_at: NOW.toISOString(), rejected_count: 0, last_rejected_at: null, rejection_reason: null, applied_count: 4, last_applied_at: NOW.toISOString() },
    });
    const report = buildDashboard(memories, usage, { now: NOW });
    expect(report.impact.top[0]!.id).toBe("applied");
    expect(report.impact.top[0]!.tier).toBe("high");
    expect(report.impact.high).toBeGreaterThanOrEqual(1);
  });

  it("detects dormant/decaying memories and lists the oldest", () => {
    const old = new Date(NOW.getTime() - 200 * DAY).toISOString();
    const memories = [mem({ id: "stale-one", status: "validated", created_at: old, body: "old" })];
    const usage = usageWith({
      "stale-one": { read_count: 0, last_read_at: null, rejected_count: 0, last_rejected_at: null, rejection_reason: null, applied_count: 0, last_applied_at: null },
    });
    const report = buildDashboard(memories, usage, { now: NOW });
    expect(report.decay.decaying).toBe(1);
    expect(report.decay.top_dormant[0]!.id).toBe("stale-one");
    expect(report.decay.top_dormant[0]!.age_days).toBeGreaterThanOrEqual(199);
    expect(report.health.prune_candidates).toBeGreaterThanOrEqual(1);
  });

  it("respects the top option", () => {
    const memories = Array.from({ length: 15 }, (_, i) => mem({ id: `m${i}`, status: "validated" }));
    const report = buildDashboard(memories, emptyUsageIndex(), { now: NOW, top: 3 });
    expect(report.impact.top).toHaveLength(3);
  });
});
