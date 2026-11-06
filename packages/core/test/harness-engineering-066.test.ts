import { describe, expect, it } from "vitest";
import {
  auditInstructionRules,
  buildFrontmatter,
  buildHarnessReport,
  checklistAcknowledged,
  checkableSignals,
  renderHarnessReport,
  selectChecklists,
  type LoadedMemory,
  type Memory,
  type Sensor,
} from "../src/index.js";

function memory(slug: string, overrides: Partial<Memory["frontmatter"]> = {}, body = "# T\n\nBody."): Memory {
  const fm = buildFrontmatter({ type: "gotcha", slug, scope: "team", status: "validated" });
  return { frontmatter: { ...fm, ...overrides }, body };
}

const checklistSensor = (paths: string[], severity: "warn" | "block" = "block"): Sensor => ({
  kind: "checklist", paths, message: "Run the GPU browser check of the PDF viewer", severity,
  autogen: false, last_fired: null,
});

describe("change-triggered checklists (field report #9 §9.1)", () => {
  it("fires only when a change touches the checklist's paths", () => {
    const m = memory("csp-pdf", { sensor: checklistSensor(["config/security/**"]) });
    expect(selectChecklists([m], ["src/app.ts"])).toEqual([]);
    const hit = selectChecklists([m], ["config/security/csp.ts", "src/app.ts"]);
    expect(hit).toHaveLength(1);
    expect(hit[0]!.matched).toEqual(["config/security/csp.ts"]);
  });

  it("falls back to the memory anchors and never fires without any scope", () => {
    const anchored = memory("anchored", { sensor: checklistSensor([]), anchor: { paths: ["deploy/nginx.conf"], symbols: [] } });
    expect(selectChecklists([anchored], ["deploy/nginx.conf"])).toHaveLength(1);
    const unscoped = memory("unscoped", { sensor: checklistSensor([]) });
    expect(selectChecklists([unscoped], ["anything.ts"])).toEqual([]);
  });

  it("accepts the acknowledgement trailer, alone or in a list", () => {
    expect(checklistAcknowledged("fix: csp\n\nHivelore-Checked: 2026-01-01-gotcha-csp", "2026-01-01-gotcha-csp")).toBe(true);
    expect(checklistAcknowledged("fix\n\nhivelore-checked: a-id, 2026-01-01-gotcha-csp", "2026-01-01-gotcha-csp")).toBe(true);
    expect(checklistAcknowledged("fix: mentions 2026-01-01-gotcha-csp in prose", "2026-01-01-gotcha-csp")).toBe(false);
  });
});

describe("harness report (field report #12 §4.3)", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const old = "2026-06-01T00:00:00.000Z";
  const recent = "2026-11-01T00:00:00.000Z";

  it("tells catching sensors from silent and never-evaluated ones, and finds archive candidates", () => {
    const regex: Sensor = { kind: "regex", pattern: "x", paths: [], message: "m", severity: "block", autogen: false, last_fired: null };
    const memories: LoadedMemory[] = [
      { filePath: "a", memory: memory("catching", { id: "s-catching", sensor: regex, created_at: old }) },
      { filePath: "b", memory: memory("silent", { id: "s-silent", sensor: regex, created_at: old }) },
      { filePath: "c", memory: memory("never", { id: "s-never", sensor: regex, created_at: old }) },
      { filePath: "d", memory: memory("unused", { id: "m-unused", created_at: old, anchor: { paths: ["gone.ts", "src/**"], symbols: [] } }) },
      { filePath: "e", memory: memory("shown", { id: "m-shown", created_at: old }) },
      { filePath: "f", memory: memory("expired", { id: "m-expired", created_at: recent, expires_when: "2026-10-01" }) },
    ];
    const report = buildHarnessReport({
      memories,
      ledger: [
        { at: recent, memory_id: "s-catching", kind: "regex", stage: "pre-commit", head_sha: "h", scope_hash: "s", outcome: "fired" },
        { at: recent, memory_id: "s-silent", kind: "regex", stage: "pre-commit", head_sha: "h", scope_hash: "s", outcome: "silent" },
      ],
      catches: [{ at: recent, id: "s-catching", source: "sensor" }],
      outcomes: [
        { at: recent, id: "m-shown", kind: "exposed", source: "hook", evidence: "observed" },
        { at: recent, id: "m-shown", kind: "applied", source: "mcp", evidence: "reported" },
      ],
      waivers: new Map(),
      anchorExists: (p) => p !== "gone.ts",
      now,
    });
    const verdict = Object.fromEntries(report.sensors.map((s) => [s.id, s.verdict]));
    expect(verdict).toEqual({ "s-catching": "catching", "s-silent": "armed-silent", "s-never": "never-evaluated" });
    expect(report.most_surfaced).toEqual([expect.objectContaining({ id: "m-shown", verdict: "followed" })]);
    expect(report.never_surfaced.map((m) => m.id)).toContain("m-unused");
    expect(report.never_surfaced.map((m) => m.id)).not.toContain("m-expired"); // too young to judge
    expect(report.dangling_anchors).toEqual([{ id: "m-unused", missing: ["gone.ts"] }]);
    expect(report.expired_decisions.map((d) => d.id)).toEqual(["m-expired"]);
    expect(renderHarnessReport(report)).toContain("archive candidates");
  });

  it("flags a sensor waived more often than it caught", () => {
    const regex: Sensor = { kind: "regex", pattern: "x", paths: [], message: "m", severity: "block", autogen: false, last_fired: null };
    const report = buildHarnessReport({
      memories: [{ filePath: "a", memory: memory("w", { id: "s-waived", sensor: regex, created_at: old }) }],
      ledger: [], catches: [], outcomes: [],
      waivers: new Map([["s-waived", 3]]),
      anchorExists: () => true,
      now,
    });
    expect(report.sensors[0]!.verdict).toBe("waived-more-than-caught");
  });
});

describe("instruction-rule audit", () => {
  it("separates enforced, checkable and judgment rules", () => {
    const audit = auditInstructionRules(
      [{
        path: "CLAUDE.md",
        content: [
          "# Rules",
          "- Never call `LocalDate.now()` without a zone.",
          "- Never run `npm publish` from an agent.",
          "- Always explain your reasoning to the user before large refactors.",
          "```",
          "- never inside a fence",
          "```",
          "<!-- haive:sensors-start -->",
          "- **2026-01-01-gotcha-money**: Never multiply by 100 to convert money.",
          "<!-- haive:sensors-end -->",
        ].join("\n"),
      }],
      [{ id: "2026-01-01-gotcha-zone", message: "LocalDate.now() reads the server zone — pass the business ZoneId.", pattern: "LocalDate\\.now\\(\\)", severity: "block" }],
    );
    const byText = (needle: string) => audit.rules.find((r) => r.text.includes(needle));
    expect(byText("LocalDate")?.class).toBe("enforced");
    expect(byText("npm publish")?.class).toBe("checkable");
    expect(byText("explain your reasoning")?.class).toBe("judgment");
    expect(byText("multiply by 100")?.class).toBe("enforced");
    expect(audit.rules.some((r) => r.text.includes("inside a fence"))).toBe(false);
    expect(audit.enforceable_coverage).toBeCloseTo(2 / 3);
  });

  it("does not mistake plain English for a code signal", () => {
    expect(checkableSignals("Do not treat these as nice-to-have: they are default-required.")).toEqual([]);
    expect(checkableSignals("Read/search the code base before editing.")).toEqual([]);
    expect(checkableSignals("Never edit `db/migrations/V1__init.sql` after it shipped.")).toContain("path");
  });
});
