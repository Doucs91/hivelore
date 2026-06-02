import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { ingestFindings } from "../src/tools/ingest-findings.js";

const SARIF = JSON.stringify({
  version: "2.1.0",
  runs: [
    {
      tool: { driver: { name: "ESLint" } },
      results: [
        {
          ruleId: "no-eval",
          level: "error",
          message: { text: "eval can be harmful." },
          locations: [
            {
              physicalLocation: {
                artifactLocation: { uri: "src/danger.ts" },
                region: { startLine: 12 },
              },
            },
          ],
        },
      ],
    },
  ],
});

describe("ingestFindings", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-ingest-test-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.teamDir!, { recursive: true });
    ctx = { paths };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  async function teamFiles(): Promise<string[]> {
    return (await readdir(ctx.paths.teamDir!)).filter((f) => f.endsWith(".md"));
  }

  it("dry_run reports drafts without writing", async () => {
    const out = await ingestFindings({ format: "sarif", report: SARIF, type: "gotcha", scope: "team", dry_run: true }, ctx);
    expect(out.parsed).toBe(1);
    expect(out.new).toBe(1);
    expect(out.dry_run).toBe(true);
    expect(out.created[0]!.file_path).toBeUndefined();
    expect(await teamFiles()).toHaveLength(0);
  });

  it("writes proposed memories anchored to the file", async () => {
    const out = await ingestFindings({ format: "sarif", report: SARIF, type: "gotcha", scope: "team", dry_run: false }, ctx);
    expect(out.new).toBe(1);
    expect(out.created[0]!.rule).toBe("no-eval");
    expect(out.created[0]!.path).toBe("src/danger.ts");
    expect(out.created[0]!.file_path).toBeDefined();
    const files = await teamFiles();
    expect(files).toHaveLength(1);
  });

  it("dedups on a second run (same ingest topic)", async () => {
    await ingestFindings({ format: "sarif", report: SARIF, type: "gotcha", scope: "team", dry_run: false }, ctx);
    const second = await ingestFindings({ format: "sarif", report: SARIF, type: "gotcha", scope: "team", dry_run: false }, ctx);
    expect(second.parsed).toBe(1);
    expect(second.new).toBe(0);
    expect(second.skipped_existing).toBe(1);
    expect(await teamFiles()).toHaveLength(1);
  });

  it("throws when neither report nor report_path provided", async () => {
    await expect(
      ingestFindings({ format: "sarif", type: "gotcha", scope: "team", dry_run: true }, ctx),
    ).rejects.toThrow(/Provide either/);
  });
});
