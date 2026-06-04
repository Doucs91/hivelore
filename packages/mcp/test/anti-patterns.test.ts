import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPreventionEvents, resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { antiPatternsCheck, isHaiveOwnedPath, stripAiDirHunks } from "../src/tools/anti-patterns-check.js";
import { classifyAntiPatternWarningForTest, preCommitCheck } from "../src/tools/precommit-check.js";

// ─── helpers ────────────────────────────────────────────────────────────────

async function writeMemory(
  dir: string,
  id: string,
  type: "attempt" | "gotcha" | "convention",
  body: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const anchorPaths = (extra.paths as string[] | undefined) ?? [];
  const anchorSymbols = (extra.symbols as string[] | undefined) ?? [];
  const sensor = extra.sensor as
    | { pattern: string; message: string; severity?: string; paths?: string[] }
    | undefined;
  const lines = [
    "---",
    `id: ${id}`,
    "scope: team",
    `type: ${type}`,
    "status: validated",
    `created_at: ${new Date().toISOString()}`,
    "anchor:",
    `  paths: [${anchorPaths.map((p) => `"${p}"`).join(", ")}]`,
    `  symbols: [${anchorSymbols.map((s) => `"${s}"`).join(", ")}]`,
    "tags: []",
  ];
  if (sensor) {
    lines.push(
      "sensor:",
      "  kind: regex",
      `  pattern: ${JSON.stringify(sensor.pattern)}`,
      `  message: ${JSON.stringify(sensor.message)}`,
      `  severity: ${sensor.severity ?? "warn"}`,
      `  paths: [${(sensor.paths ?? []).map((p) => `"${p}"`).join(", ")}]`,
    );
  }
  lines.push("---");
  const frontmatter = lines.join("\n");
  await writeFile(path.join(dir, `${id}.md`), `${frontmatter}\n${body}\n`, "utf8");
}

// ─── antiPatternsCheck ──────────────────────────────────────────────────────

describe("antiPatternsCheck", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-ap-test-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.teamDir, { recursive: true });
    await mkdir(paths.personalDir, { recursive: true });
    ctx = { paths };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns empty when no .ai/memories dir", async () => {
    const noInit = await mkdtemp(path.join(tmpdir(), "haive-ap-noinit-"));
    try {
      const ctx2: HaiveContext = { paths: resolveHaivePaths(noInit) };
      const result = await antiPatternsCheck({ diff: "some diff", paths: [], limit: 8, semantic: false }, ctx2);
      expect(result.scanned).toBe(0);
      expect(result.warnings).toHaveLength(0);
      expect(result.notice).toBeDefined();
    } finally {
      await rm(noInit, { recursive: true, force: true });
    }
  });

  it("returns empty when no attempt/gotcha memories exist", async () => {
    await writeMemory(ctx.paths.teamDir!, "2024-01-01-convention-foo", "convention", "Always use ESM.");
    const result = await antiPatternsCheck({ diff: "esm convention", paths: [], limit: 8, semantic: false }, ctx);
    expect(result.scanned).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns notice when no diff and no paths", async () => {
    const result = await antiPatternsCheck({ diff: undefined, paths: [], limit: 8, semantic: false }, ctx);
    expect(result.scanned).toBe(0);
    expect(result.notice).toMatch(/Nothing to check/);
  });

  it("fires a regex sensor deterministically on an added diff line (no semantics)", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-gotcha-open-in-view",
      "gotcha",
      "# open-in-view\n\nspring.jpa.open-in-view is intentionally false.",
      {
        paths: ["src/app.properties"],
        sensor: {
          pattern: "open-in-view\\s*=\\s*true",
          message: "open-in-view was disabled on purpose — do not set it true.",
          severity: "warn",
        },
      },
    );

    const result = await antiPatternsCheck({
      diff: "+spring.jpa.open-in-view=true",
      paths: ["src/app.properties"],
      limit: 8,
      semantic: false, // prove the hit is deterministic, not semantic
    }, ctx);

    const warning = result.warnings.find((w) => w.id === "2024-01-01-gotcha-open-in-view");
    expect(warning).toBeDefined();
    expect(warning!.reasons).toContain("sensor");
    expect(warning!.sensor_message).toContain("do not set it true");
    expect(warning!.sensor_severity).toBe("warn");
  });

  // ── prevention-event recording: only HIGH-CONFIDENCE catches count as outcomes ──

  it("records a prevention event when a deterministic sensor fires", async () => {
    await writeMemory(
      ctx.paths.teamDir!, "2024-01-01-gotcha-reload", "gotcha",
      "# uvicorn reload\n\nNever ship reload=True.",
      { paths: ["src/main.py"], sensor: { pattern: "reload\\s*=\\s*True", message: "no reload=True", severity: "warn" } },
    );
    await antiPatternsCheck({ diff: "+uvicorn.run(app, reload=True)", paths: ["src/main.py"], limit: 8, semantic: false }, ctx);
    const events = await loadPreventionEvents(ctx.paths);
    expect(events.map((e) => e.id)).toContain("2024-01-01-gotcha-reload");
  });

  it("does NOT record a prevention event for a bare distinctive-literal match in an unrelated file", async () => {
    // No sensor, no anchor overlap with the changed file: a single rare shared word ("frobnicate")
    // makes this distinctive-literal, which is enough to SURFACE a review warning but must NOT be
    // counted as a measured catch — this is the cold-start phantom-metric guard.
    await writeMemory(
      ctx.paths.teamDir!, "2024-01-01-attempt-frobnicate", "attempt",
      "# frobnicate\n\nThe frobnicate helper corrupts state — never call frobnicate.",
      { paths: ["src/legacy/frob.ts"] }, // anchored elsewhere, not to the changed file
    );
    const result = await antiPatternsCheck(
      { diff: "+const y = frobnicate();", paths: ["src/unrelated/widget.ts"], limit: 8, semantic: false },
      ctx,
    );
    // It still surfaces as advisory…
    expect(result.warnings.some((w) => w.id === "2024-01-01-attempt-frobnicate")).toBe(true);
    // …but is not recorded as an outcome.
    const events = await loadPreventionEvents(ctx.paths);
    expect(events).toHaveLength(0);
  });

  it("does NOT fire the sensor when the bad pattern is only on a removed line", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-gotcha-open-in-view2",
      "gotcha",
      "# open-in-view\n\nDo not enable open-in-view.",
      {
        paths: ["src/app.properties"],
        sensor: {
          pattern: "open-in-view\\s*=\\s*true",
          message: "do not enable open-in-view",
        },
      },
    );

    const result = await antiPatternsCheck({
      diff: "-spring.jpa.open-in-view=true\n+spring.jpa.open-in-view=false",
      paths: ["src/app.properties"],
      limit: 8,
      semantic: false,
    }, ctx);

    const warning = result.warnings.find((w) => w.id === "2024-01-01-gotcha-open-in-view2");
    // The removed line should not trip the sensor; if surfaced at all it must not be via "sensor".
    expect(warning?.reasons ?? []).not.toContain("sensor");
  });

  it("does not let a sensor scoped to one file fire on another file in the same diff", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-gotcha-backend-open-in-view",
      "gotcha",
      "# open-in-view\n\nDo not enable open-in-view in backend config.",
      {
        paths: ["src/backend/application.properties"],
        sensor: {
          pattern: "open-in-view\\s*=\\s*true",
          message: "do not enable backend open-in-view",
        },
      },
    );

    const result = await antiPatternsCheck({
      diff: [
        "diff --git a/src/backend/application.properties b/src/backend/application.properties",
        "--- a/src/backend/application.properties",
        "+++ b/src/backend/application.properties",
        "+spring.jpa.show-sql=true",
        "diff --git a/src/frontend/App.tsx b/src/frontend/App.tsx",
        "--- a/src/frontend/App.tsx",
        "+++ b/src/frontend/App.tsx",
        "+const value = 'open-in-view=true';",
      ].join("\n"),
      paths: ["src/backend/application.properties", "src/frontend/App.tsx"],
      limit: 8,
      semantic: false,
    }, ctx);

    const warning = result.warnings.find((w) => w.id === "2024-01-01-gotcha-backend-open-in-view");
    expect(warning?.reasons ?? []).not.toContain("sensor");
  });

  it("matches attempt memory via literal token overlap in diff", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-attempt-no-lodash",
      "attempt",
      "# No lodash\n\nDo not import lodash in this project — use native Array methods instead.",
    );

    const result = await antiPatternsCheck({
      diff: "- import _ from 'lodash'\n+ // removed lodash dependency",
      paths: [],
      limit: 8,
      semantic: false,
    }, ctx);

    expect(result.scanned).toBe(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.id).toBe("2024-01-01-attempt-no-lodash");
    expect(result.warnings[0]!.type).toBe("attempt");
    expect(result.warnings[0]!.reasons).toContain("literal");
  });

  it("matches gotcha memory via anchor path overlap", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-gotcha-migration-checksum",
      "gotcha",
      "# Flyway checksum\n\nNever modify existing migration files — checksums will fail.",
      { paths: ["src/db/migrations/V1__init.sql"] },
    );

    const result = await antiPatternsCheck({
      diff: undefined,
      paths: ["src/db/migrations/V1__init.sql"],
      limit: 8,
      semantic: false,
    }, ctx);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.reasons).toContain("anchor");
  });

  it("deduplicates: memory matched by both anchor and literal gets a single warning with both reasons", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-gotcha-migration-edit",
      "gotcha",
      "# Migration edit forbidden\n\nNever modify an existing migration file.",
      { paths: ["db/migrations/V1__init.sql"] },
    );

    const result = await antiPatternsCheck({
      diff: "- ALTER TABLE migration_edit ...",
      paths: ["db/migrations/V1__init.sql"],
      limit: 8,
      semantic: false,
    }, ctx);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.reasons).toContain("anchor");
    expect(result.warnings[0]!.reasons).toContain("literal");
  });

  it("respects limit cap", async () => {
    for (let i = 0; i < 5; i++) {
      await writeMemory(
        ctx.paths.teamDir!,
        `2024-01-0${i + 1}-gotcha-item-${i}`,
        "gotcha",
        `# Item ${i}\n\nDo not use pattern-${i} in production code.`,
      );
    }

    const result = await antiPatternsCheck({
      diff: "pattern-0 pattern-1 pattern-2 pattern-3 pattern-4",
      paths: [],
      limit: 2,
      semantic: false,
    }, ctx);

    expect(result.warnings.length).toBeLessThanOrEqual(2);
  });

  it("skips rejected and deprecated memories", async () => {
    const paths = resolveHaivePaths(workDir);
    const id = "2024-01-01-attempt-rejected-item";
    await writeFile(
      path.join(paths.teamDir!, `${id}.md`),
      [
        "---",
        `id: ${id}`,
        "scope: team",
        "type: attempt",
        "status: rejected",
        `created_at: ${new Date().toISOString()}`,
        "anchor:",
        "  paths: []",
        "  symbols: []",
        "tags: []",
        "---",
        "This was rejected — do not import foo.",
        "",
      ].join("\n"),
      "utf8",
    );

    const result = await antiPatternsCheck({
      diff: "import foo from 'foo'",
      paths: [],
      limit: 8,
      semantic: false,
    }, ctx);

    expect(result.warnings).toHaveLength(0);
  });

  it("skips memories retired by lifecycle metadata", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-attempt-fixed-flag",
      "attempt",
      "# Fixed flag\n\nFixed in 0.10.0; kept only for audit history, not active agent warnings.",
    );

    const result = await antiPatternsCheck({
      diff: "+ fixed flag usage",
      paths: [],
      limit: 8,
      semantic: false,
    }, ctx);

    expect(result.scanned).toBe(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── preCommitCheck ─────────────────────────────────────────────────────────

describe("preCommitCheck", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-precommit-test-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.teamDir, { recursive: true });
    await mkdir(paths.personalDir, { recursive: true });
    ctx = { paths };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("returns no-block with notice when no diff and no paths provided", async () => {
    const result = await preCommitCheck({ diff: undefined, paths: [], block_on: "high-confidence", semantic: false }, ctx);
    expect(result.should_block).toBe(false);
    expect(result.notice).toMatch(/Nothing to check/);
  });

  it("passes cleanly when no attempt/gotcha memories exist", async () => {
    await writeMemory(ctx.paths.teamDir!, "2024-01-01-convention-esm", "convention", "Use ESM.");
    const result = await preCommitCheck({
      diff: "import esm from 'esm'",
      paths: ["src/index.ts"],
      block_on: "high-confidence",
      semantic: false,
    }, ctx);
    expect(result.should_block).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  // ── Config-only false-positive regression (P1 fix) ──────────────────────

  it("does not block a config-only commit even when tokens match a gotcha", async () => {
    // This is the regression from the known issue: committing haive.config.json
    // triggered gotchas about 'npm install' and 'package.json' via literal match.
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-attempt-npm-install-without-nested",
      "attempt",
      "# npm install without nested node_modules\n\nWhen hot-swapping, always copy to nested node_modules too. npm install alone is not enough.",
    );

    const result = await preCommitCheck({
      diff: '- "haive": "0.9.0"\n+ "haive": "0.9.21"\n+++ package.json\n npm install -g @hiveai/cli',
      paths: [".ai/haive.config.json", "package.json", ".github/workflows/haive-sync.yml"],
      block_on: "high-confidence",
      semantic: false,
    }, ctx);

    // All warnings should be downgraded to info — should not block
    expect(result.should_block).toBe(false);
    const blocking = result.warnings.filter((w) => w.level === "blocking");
    const review = result.warnings.filter((w) => w.level === "review");
    expect(blocking).toHaveLength(0);
    expect(review).toHaveLength(0);
  });

  it("does not block a .gitignore-only commit even when tokens match attempt memories", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-attempt-haive-init-yes",
      "attempt",
      "# haive init --yes fails\n\nThe CLI init command does not expose --yes; it exits with unknown option.",
    );

    const result = await preCommitCheck({
      diff: "+.ai/.cache\n+.ai/.runtime",
      paths: [".gitignore"],
      block_on: "high-confidence",
      semantic: false,
    }, ctx);

    expect(result.should_block).toBe(false);
  });

  it("anchor match on a source file is surfaced (not silently dropped like config-only non-anchored)", async () => {
    // An anchor-only match (no semantic, no literal) is classified as "info" — it surfaces the
    // convention for awareness but does not block. Critically, it must NOT be silently dropped via
    // the config-only downgrade path (which only applies to non-anchored warnings).
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-gotcha-no-direct-db",
      "gotcha",
      "# Never access DB directly\n\nAll DB calls must go through the repository layer.",
      { paths: ["src/service.ts"] },
    );

    const result = await preCommitCheck({
      diff: "+ some change to service",
      paths: ["src/service.ts"],
      block_on: "never",
      semantic: false,
    }, ctx);

    // The anchor match on a source file MUST be surfaced at some level
    expect(result.warnings.length).toBeGreaterThan(0);
    const warning = result.warnings.find((w) => w.id === "2024-01-01-gotcha-no-direct-db");
    expect(warning).toBeDefined();
    // Must be surfaced at some actionable level — not silently dropped
    expect(["info", "review", "blocking"]).toContain(warning?.level);
    // The rationale must NOT reference the config-only downgrade (which only fires for config paths)
    expect(warning?.rationale).not.toMatch(/config-only/);
  });

  it("anchor match on source file + literal overlap produces review level (high-confidence memory)", async () => {
    // When the diff tokens also appear in the memory body, anchor + literal → "review" level.
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-gotcha-no-lodash-service",
      "gotcha",
      "# Never import lodash in service files\n\nAlways use native array methods instead of lodash.",
      { paths: ["src/service.ts"] },
    );

    const result = await preCommitCheck({
      diff: "import lodash from lodash",
      paths: ["src/service.ts"],
      block_on: "any",
      semantic: false,
    }, ctx);

    const warning = result.warnings.find((w) => w.id === "2024-01-01-gotcha-no-lodash-service");
    expect(warning).toBeDefined();
    // anchor + literal match on high-confidence (trusted) memory → review
    expect(warning?.level).toBe("review");
    expect(result.should_block).toBe(true); // block_on: "any" with a review warning
  });

  // ── stale_anchors paths correctness (P0 fix) ────────────────────────────

  it("stale_anchors.paths contains only the paths that overlap with the anchor — not all changed paths", async () => {
    // Write a convention memory anchored to one specific file
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-convention-payments-api",
      "convention",
      "# Payments API convention\n\nAlways validate amounts before calling the payment gateway.",
      { paths: ["src/payments/service.ts"] },
    );

    // The check touches two files, but only one overlaps with the anchor
    const result = await preCommitCheck({
      diff: "",
      paths: ["src/payments/service.ts", "src/unrelated/helper.ts"],
      block_on: "never",
      semantic: false,
    }, ctx);

    // relevant_memories should surface the anchored convention
    expect(result.relevant_memories.some((m) => m.id === "2024-01-01-convention-payments-api")).toBe(true);
    // If a stale_anchor is reported, its paths should only include the overlapping file
    for (const stale of result.stale_anchors) {
      if (stale.id === "2024-01-01-convention-payments-api") {
        expect(stale.paths).not.toContain("src/unrelated/helper.ts");
        expect(stale.paths).toContain("src/payments/service.ts");
      }
    }
  });

  it("summary counts are consistent with warnings array lengths", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-attempt-never-lodash",
      "attempt",
      "# No lodash\n\nDo not use lodash.",
    );

    const result = await preCommitCheck({
      diff: "import lodash from 'lodash'",
      paths: ["src/utils.ts"],
      block_on: "high-confidence",
      semantic: false,
    }, ctx);

    const totalInWarnings =
      (result.summary.blocking_warnings ?? 0) +
      (result.summary.review_warnings ?? 0) +
      (result.summary.info_warnings ?? 0);
    expect(totalInWarnings).toBe(result.warnings.length);
  });

  it("does not block on generic unanchored semantic matches below the stricter threshold", () => {
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-attempt-generic-test-note",
      type: "attempt",
      scope: "team",
      confidence: "trusted",
      body_preview: "A historical test methodology note with broadly similar wording.",
      reasons: ["literal", "semantic"],
      semantic_score: 0.68,
    }, ["packages/cli/test/cli.test.ts"]);

    expect(warning.level).toBe("review");
    expect(warning.rationale).toContain("below blocking threshold");
  });

  it("keeps anchored high-confidence semantic matches below 0.75 in review", () => {
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-gotcha-anchored-production-risk",
      type: "gotcha",
      scope: "team",
      confidence: "authoritative",
      body_preview: "A gotcha anchored to exactly the changed file.",
      reasons: ["anchor", "semantic"],
      semantic_score: 0.68,
    }, ["src/service.ts"]);

    expect(warning.level).toBe("review");
    expect(warning.rationale).toContain("below blocking threshold");
  });

  it("can still block very strong high-confidence semantic matches", () => {
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-gotcha-anchored-production-risk",
      type: "gotcha",
      scope: "team",
      confidence: "authoritative",
      body_preview: "A gotcha anchored to exactly the changed file.",
      reasons: ["anchor", "semantic"],
      semantic_score: 0.81,
    }, ["src/service.ts"]);

    expect(warning.level).toBe("blocking");
    expect(warning.rationale).toContain("0.75");
  });

  // ── anchored gate (honest blocking) ─────────────────────────────────────

  it("anchored gate blocks an anchored + literal high-confidence anti-pattern", () => {
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-attempt-no-bigint",
      type: "attempt",
      scope: "team",
      confidence: "trusted",
      body_preview: "BigInt broke serialization in math — do not use BigInt.",
      reasons: ["anchor", "literal"],
      distinctive_literal: true, // the diff reintroduced the distinctive token (BigInt)
      anchor_paths: ["src/math.ts"],
    }, ["src/math.ts"], true);

    expect(warning.level).toBe("blocking");
    expect(warning.rationale).toContain("anchored gate");
  });

  it("anchored gate does NOT block on a non-distinctive literal overlap (false-positive guard)", () => {
    // Anchor + literal on a COMMON word (no distinctive_literal) — e.g. editing an anchored
    // file for an unrelated reason, or a version bump. Must be review, never blocking.
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-gotcha-scope-thing",
      type: "gotcha",
      scope: "team",
      confidence: "authoritative",
      body_preview: "mem_save scope was overridden by defaultScope.",
      reasons: ["anchor", "literal"], // literal present, but distinctive_literal is absent
      anchor_paths: ["src/mem-save.ts"],
    }, ["src/mem-save.ts"], true);

    expect(warning.level).toBe("review");
    expect(warning.rationale).not.toContain("anchored gate");
  });

  it("anchored gate keeps personal anti-pattern memories as review guidance", () => {
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-attempt-personal-no-bigint",
      type: "attempt",
      scope: "personal",
      confidence: "authoritative",
      body_preview: "BigInt broke my local experiment.",
      reasons: ["anchor", "literal"],
      anchor_paths: ["src/math.ts"],
    }, ["src/math.ts"], true);

    expect(warning.level).toBe("review");
    expect(warning.rationale).not.toContain("anchored gate");
  });

  it("anchored gate leaves the same warning in review when not opted in", () => {
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-attempt-no-bigint",
      type: "attempt",
      scope: "team",
      confidence: "trusted",
      body_preview: "BigInt broke serialization in math — do not use BigInt.",
      reasons: ["anchor", "literal"],
      anchor_paths: ["src/math.ts"],
    }, ["src/math.ts"], false);

    expect(warning.level).toBe("review");
  });

  it("demotes a non-anchored memory whose deterministic sensor did NOT fire to info (precision)", () => {
    // Noise reduction (#2): a memory carries a sensor, the sensor did not fire, and it is not
    // anchored to a touched file → strong evidence of non-violation → info (hidden), not review.
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-gotcha-has-sensor-not-fired",
      type: "gotcha",
      scope: "team",
      confidence: "authoritative",
      body_preview: "an unrelated gotcha that happens to carry a regex sensor",
      reasons: ["literal", "semantic"],
      semantic_score: 0.66,
      has_sensor: true,
      anchor_paths: ["packages/mcp/package.json"],
    }, ["packages/core/src/probe.ts"], false);

    expect(warning.level).toBe("info");
    expect(warning.rationale).toMatch(/sensor that did not fire/);
  });

  it("raises the uncorroborated semantic review floor to 0.65 (noise reduction)", () => {
    const below = classifyAntiPatternWarningForTest({
      id: "2024-01-01-gotcha-weak-semantic",
      type: "gotcha",
      scope: "team",
      confidence: "authoritative",
      body_preview: "weak semantic-only match against generic text",
      reasons: ["semantic"],
      semantic_score: 0.62,
      anchor_paths: [],
    }, ["packages/core/src/probe.ts"], false);
    expect(below.level).toBe("info"); // 0.62 < 0.65 → hidden as noise

    const above = classifyAntiPatternWarningForTest({
      id: "2024-01-01-gotcha-ok-semantic",
      type: "gotcha",
      scope: "team",
      confidence: "authoritative",
      body_preview: "stronger semantic match worth a human's attention",
      reasons: ["semantic"],
      semantic_score: 0.7,
      anchor_paths: [],
    }, ["packages/core/src/probe.ts"], false);
    expect(above.level).toBe("review"); // 0.7 >= 0.65 → review
  });

  it("anchored gate still does NOT block a non-anchored config-token match (false-positive guard)", () => {
    // The documented false-positive class: a NON-anchored gotcha matching a config file only via
    // broad tokens (npm/install/package.json). The anchored gate requires an anchor reason, and
    // fileTypeDowngradeReason downgrades non-anchored config matches to info — so this never blocks.
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-attempt-npm-install-quirk",
      type: "attempt",
      scope: "team",
      confidence: "authoritative",
      body_preview: "npm install of local packages fails; use pnpm workspace:* instead.",
      reasons: ["literal"],
      tags: ["npm", "install"],
    }, [".ai/haive.config.json"], true);

    expect(warning.level).toBe("info");
  });

  it("anchored gate blocks via end-to-end preCommitCheck when anchored_blocks is set", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-attempt-no-lodash-service",
      "attempt",
      "# Never import lodash in service files\n\nAlways use native array methods instead of lodash.",
      { paths: ["src/service.ts"] },
    );

    const result = await preCommitCheck({
      diff: "import lodash from lodash",
      paths: ["src/service.ts"],
      block_on: "high-confidence",
      anchored_blocks: true,
      semantic: false,
    }, ctx);

    const warning = result.warnings.find((w) => w.id === "2024-01-01-attempt-no-lodash-service");
    expect(warning?.level).toBe("blocking");
    expect(result.should_block).toBe(true);
  });

  it("uses the anchored source file, not .ai artifacts, in repair commands", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-attempt-no-lowercase-status",
      "attempt",
      "# Status literals\n\nUsing lowercase status ok failed; return uppercase OK or KO.",
      { paths: ["src/status.ts"] },
    );

    const result = await preCommitCheck({
      diff: [
        "diff --git a/src/status.ts b/src/status.ts",
        "--- a/src/status.ts",
        "+++ b/src/status.ts",
        "+export const status = \"ok\";",
      ].join("\n"),
      paths: [
        ".ai/.cache/.gitignore",
        ".ai/.runtime/README.md",
        "src/status.ts",
      ],
      block_on: "high-confidence",
      anchored_blocks: true,
      semantic: false,
    }, ctx);

    const warning = result.warnings.find((w) => w.id === "2024-01-01-attempt-no-lowercase-status");
    expect(warning?.repair_command).toContain('--files "src/status.ts"');
    expect(warning?.repair_command).not.toContain(".ai/.cache");
  });

  it("blocks a deterministic block-severity sensor hit even without semantic search", async () => {
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-gotcha-no-open-in-view",
      "gotcha",
      "# open-in-view\n\nDo not enable open-in-view.",
      {
        paths: ["src/app.properties"],
        sensor: {
          pattern: "open-in-view\\s*=\\s*true",
          message: "open-in-view must stay disabled",
          severity: "block",
        },
      },
    );

    const result = await preCommitCheck({
      diff: "+spring.jpa.open-in-view=true",
      paths: ["src/app.properties"],
      block_on: "high-confidence",
      anchored_blocks: false,
      semantic: false,
    }, ctx);

    const warning = result.warnings.find((w) => w.id === "2024-01-01-gotcha-no-open-in-view");
    expect(warning?.reasons).toContain("sensor");
    expect(warning?.level).toBe("blocking");
    expect(result.should_block).toBe(true);
  });

  it("literal-matches an identifier embedded in punctuation (no spaces) and blocks deterministically", async () => {
    // Regression: a code diff like `Number(BigInt(a)+BigInt(b))` has no spaces around BigInt,
    // so whitespace-only tokenization never produced a "literal" reason and blocking depended on
    // the warmup-sensitive semantic score. The code-aware tokenizer fixes this — note semantic:false.
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-attempt-no-bigint-math",
      "attempt",
      "# No BigInt in math\n\nBigInt broke serialization — never use BigInt in math.ts.",
      { paths: ["src/math.ts"] },
    );

    const result = await preCommitCheck({
      diff: "+export function add(a:number,b:number){return Number(BigInt(a)+BigInt(b))}",
      paths: ["src/math.ts"],
      block_on: "high-confidence",
      anchored_blocks: true,
      semantic: false,
    }, ctx);

    const warning = result.warnings.find((w) => w.id === "2024-01-01-attempt-no-bigint-math");
    expect(warning?.reasons).toContain("literal");
    expect(warning?.level).toBe("blocking");
    expect(result.should_block).toBe(true);
  });

  it("downgrades a build/packaging gotcha when no package/build file changed", () => {
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-attempt-npm-install-quirk",
      type: "attempt",
      scope: "team",
      confidence: "authoritative",
      body_preview: "npm install of local packages fails; use pnpm workspace:* instead.",
      reasons: ["literal"],
      tags: ["npm", "install", "dev-workflow"],
    }, ["src/payment.ts"]);

    expect(warning.level).toBe("info");
    expect(warning.rationale).toContain("no package/build file changed");
  });

  it("keeps a build/packaging gotcha actionable when a package file IS in the change", () => {
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-attempt-npm-install-quirk",
      type: "attempt",
      scope: "team",
      confidence: "authoritative",
      body_preview: "npm install of local packages fails; use pnpm workspace:* instead.",
      reasons: ["literal"],
      tags: ["npm", "install", "dev-workflow"],
    }, ["package.json"]);

    // package.json is a config path → the existing config-only downgrade applies instead.
    // The point: the build-scoped INVERSE rule must NOT be what fired here.
    expect(warning.rationale).not.toContain("no package/build file changed");
  });

  // ── Dotfile config-only downgrade (Fix 5 regression) ─────────────────────

  it("does not block on .editorconfig-only commit", async () => {
    await writeMemory(ctx.paths.teamDir!, "2024-01-01-gotcha-indentation", "gotcha",
      "# Tab vs spaces\n\nAlways use spaces — tabs break the parser.");
    const result = await preCommitCheck({
      diff: "+indent_style = space",
      paths: [".editorconfig"],
      block_on: "high-confidence",
      semantic: false,
    }, ctx);
    expect(result.should_block).toBe(false);
    const blocking = result.warnings.filter((w) => w.level === "blocking" || w.level === "review");
    expect(blocking).toHaveLength(0);
  });

  it("does not block on .nvmrc-only commit", async () => {
    await writeMemory(ctx.paths.teamDir!, "2024-01-01-gotcha-node-version", "gotcha",
      "# Node version\n\nDo not use node 20 — use node 22.");
    const result = await preCommitCheck({
      diff: "-20\n+22",
      paths: [".nvmrc"],
      block_on: "high-confidence",
      semantic: false,
    }, ctx);
    expect(result.should_block).toBe(false);
  });

  it("does not block on Dockerfile-only commit", async () => {
    await writeMemory(ctx.paths.teamDir!, "2024-01-01-gotcha-docker-user", "gotcha",
      "# Docker user\n\nAlways set a non-root user in Dockerfile.");
    const result = await preCommitCheck({
      diff: "+USER node",
      paths: ["Dockerfile"],
      block_on: "high-confidence",
      semantic: false,
    }, ctx);
    expect(result.should_block).toBe(false);
  });

  it("does not block on .npmrc-only commit", async () => {
    await writeMemory(ctx.paths.teamDir!, "2024-01-01-gotcha-npm-registry", "gotcha",
      "# npm registry\n\nDo not use private registry unless authenticated.");
    const result = await preCommitCheck({
      diff: "+registry=https://registry.npmjs.org",
      paths: [".npmrc"],
      block_on: "high-confidence",
      semantic: false,
    }, ctx);
    expect(result.should_block).toBe(false);
  });

  // ── Sensor-veto: memory with sensor that did NOT fire → review, not blocking ─

  it("sensor-veto: downgrades blocking to review when memory has a sensor that did not fire", () => {
    // A memory with a precise sensor (e.g. BigInt in a specific form) should NOT block when
    // the diff contains a related token but the sensor regex doesn't match — the sensor is
    // the authoritative check, so the broad literal match alone is insufficient.
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-gotcha-no-bigint",
      type: "gotcha",
      scope: "team",
      confidence: "authoritative",
      body_preview: "# No BigInt\n\nBigInt broke JSON serialization — do not use BigInt.",
      reasons: ["anchor", "literal"],
      distinctive_literal: true, // distinctive overlap, but the sensor (authoritative) did not fire
      anchor_paths: ["src/math.ts"],
      has_sensor: true, // memory has a sensor, but it did NOT fire (no "sensor" in reasons)
    }, ["src/math.ts"], true); // anchoredBlocks = true

    // Should be review, not blocking — sensor didn't confirm the bad pattern
    expect(warning.level).toBe("review");
    expect(warning.rationale).toContain("sensor");
    expect(warning.rationale).toContain("did not fire");
  });

  it("sensor-veto: also downgrades very strong semantic matches (score >= 0.75) when sensor didn't fire", () => {
    // The isBlockingWarning path fires on semantic >= 0.75 regardless of anchored mode.
    // The sensor-veto must apply there too — a non-firing sensor overrides even a 0.9 score.
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-gotcha-exports-missing",
      type: "gotcha",
      scope: "team",
      confidence: "authoritative",
      body_preview: "require.resolve fails when ./package.json is missing from exports",
      reasons: ["literal", "semantic"],
      semantic_score: 0.82, // above the 0.75 blocking threshold
      has_sensor: true,     // memory has a sensor, but it did NOT fire
    }, ["packages/mcp/package.json"], false); // anchoredBlocks = false

    expect(warning.level).toBe("review");
    expect(warning.rationale).toContain("sensor");
    expect(warning.rationale).toContain("did not fire");
  });

  it("keeps personal very-strong semantic anti-pattern memories as review guidance", () => {
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-attempt-personal-semantic",
      type: "attempt",
      scope: "personal",
      confidence: "authoritative",
      body_preview: "This local experiment failed in one developer environment.",
      reasons: ["semantic"],
      semantic_score: 0.9,
    }, ["src/service.ts"], false);

    expect(warning.level).toBe("review");
    expect(warning.rationale).toContain("personal");
  });

  it("sensor-veto: still blocks when the sensor DID fire (sensor reason present)", () => {
    // If the sensor itself fires, it takes precedence — this is a true positive
    const warning = classifyAntiPatternWarningForTest({
      id: "2024-01-01-gotcha-no-bigint",
      type: "gotcha",
      scope: "team",
      confidence: "authoritative",
      body_preview: "# No BigInt\n\nBigInt broke JSON serialization — do not use BigInt.",
      reasons: ["anchor", "literal", "sensor"],
      anchor_paths: ["src/math.ts"],
      has_sensor: true,
      sensor_severity: "block",
    }, ["src/math.ts"], true);

    expect(warning.level).toBe("blocking");
    expect(warning.rationale).toContain("sensor");
  });

  it("sensor-veto: end-to-end — sensor that does not match prevents blocking on literal tokens", async () => {
    // Memory has sensor pattern `BigInt\s*\(` — matches only direct BigInt() calls.
    // Diff uses BigInt in a comment (not calling it), so sensor should not fire.
    // With sensor-veto, anchor + literal should be downgraded to review.
    await writeMemory(
      ctx.paths.teamDir!,
      "2024-01-01-gotcha-bigint-call",
      "gotcha",
      "# BigInt() calls crash serialization\n\nDo not call BigInt() — it breaks JSON.",
      {
        paths: ["src/math.ts"],
        sensor: {
          pattern: "BigInt\\s*\\(",
          message: "BigInt() calls break JSON serialization",
          severity: "warn",
          paths: ["src/math.ts"],
        },
      },
    );

    const result = await preCommitCheck({
      // Diff mentions BigInt in a comment — literal match fires, sensor does NOT
      diff: [
        "diff --git a/src/math.ts b/src/math.ts",
        "--- a/src/math.ts",
        "+++ b/src/math.ts",
        "+// NOTE: BigInt was removed from this module entirely",
      ].join("\n"),
      paths: ["src/math.ts"],
      block_on: "high-confidence",
      anchored_blocks: true,
      semantic: false,
    }, ctx);

    const warning = result.warnings.find((w) => w.id === "2024-01-01-gotcha-bigint-call");
    expect(warning).toBeDefined();
    expect(warning?.reasons).toContain("literal");
    expect(warning?.reasons).not.toContain("sensor");
    // Sensor-veto: downgraded from blocking to review
    expect(warning?.level).toBe("review");
    // should_block checks only blocking warnings (stale anchors are separate)
    const blockingWarnings = result.warnings.filter((w) => w.level === "blocking");
    expect(blockingWarnings).toHaveLength(0);
  });
});

describe("stripAiDirHunks", () => {
  it("drops .ai/ file hunks so a memory can't self-match its own backing file", () => {
    const diff = [
      "diff --git a/.ai/memories/team/x.md b/.ai/memories/team/x.md",
      "--- a/.ai/memories/team/x.md",
      "+++ b/.ai/memories/team/x.md",
      "+do not run npm install -g @hiveai/core",
      "diff --git a/packages/cli/src/index.ts b/packages/cli/src/index.ts",
      "--- a/packages/cli/src/index.ts",
      "+++ b/packages/cli/src/index.ts",
      "+const x = 1;",
    ].join("\n");
    const out = stripAiDirHunks(diff);
    expect(out).not.toContain("npm install -g @hiveai/core");
    expect(out).toContain("const x = 1;");
    expect(out).toContain("packages/cli/src/index.ts");
  });

  it("keeps a pure code diff unchanged", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "+const a = 1;",
    ].join("\n");
    expect(stripAiDirHunks(diff)).toBe(diff);
  });

  it("returns non-git text as-is", () => {
    expect(stripAiDirHunks("+just some added text")).toBe("+just some added text");
  });

  it("drops hAIve-generated bridge/config/workflow hunks so a fresh-init commit can't self-match", () => {
    // The first commit after `haive init` stages the seeded corpus AND every file init generated
    // (bridges, .gitignore, MCP configs, workflows). None are application code; none may corroborate.
    const diff = [
      "diff --git a/AGENTS.md b/AGENTS.md",
      "+- gotcha: never ship uvicorn reload=True to production",
      "diff --git a/.gitignore b/.gitignore",
      "+.ai/.cache/*",
      "diff --git a/.github/workflows/haive-enforcement.yml b/.github/workflows/haive-enforcement.yml",
      "+      - uses: actions/cache@v4",
      "diff --git a/CLAUDE.md b/CLAUDE.md",
      "+prisma client disconnect lambda guidance",
      "diff --git a/src/main.py b/src/main.py",
      "+uvicorn.run(app, reload=True)",
    ].join("\n");
    const out = stripAiDirHunks(diff);
    // Generated files gone…
    expect(out).not.toContain("AGENTS.md");
    expect(out).not.toContain(".gitignore");
    expect(out).not.toContain("haive-enforcement.yml");
    expect(out).not.toContain("CLAUDE.md");
    // …real code kept.
    expect(out).toContain("src/main.py");
    expect(out).toContain("uvicorn.run(app, reload=True)");
  });
});

describe("isHaiveOwnedPath", () => {
  it("flags the .ai/ knowledge base and hAIve-generated files", () => {
    for (const p of [
      ".ai/memories/team/x.md", ".ai/code-map.json",
      "AGENTS.md", "CLAUDE.md", ".cursorrules", ".clinerules", ".windsurfrules",
      ".github/copilot-instructions.md", ".sourcegraph/cody-rules.md",
      ".gitignore", ".mcp.json", ".cursor/mcp.json", ".vscode/mcp.json",
      ".cursor/rules/haive-mcp-required.mdc", ".github/workflows/haive-sync.yml",
    ]) {
      expect(isHaiveOwnedPath(p)).toBe(true);
    }
  });

  it("does not flag application code or a user's own CI workflow", () => {
    for (const p of [
      "src/index.ts", "packages/cli/src/app.ts", "main.py", "README.md",
      ".github/workflows/ci.yml", "config/settings.json",
    ]) {
      expect(isHaiveOwnedPath(p)).toBe(false);
    }
  });
});
