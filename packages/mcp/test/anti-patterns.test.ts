import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { antiPatternsCheck } from "../src/tools/anti-patterns-check.js";
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
  const frontmatter = [
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
    "---",
  ].join("\n");
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
});
