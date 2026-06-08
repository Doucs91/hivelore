import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveHaivePaths } from "@hiveai/core";
import type { HaiveContext } from "../src/context.js";
import { memSave } from "../src/tools/mem-save.js";
import { memApprove } from "../src/tools/mem-approve.js";

describe("memApprove — validation provenance", () => {
  let workDir: string;
  let ctx: HaiveContext;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-approve-"));
    const paths = resolveHaivePaths(workDir);
    await mkdir(paths.memoriesDir, { recursive: true });
    ctx = { paths };
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("records validated_by: agent when an AI agent approves via MCP", async () => {
    const saved = await memSave(
      { type: "decision", slug: "x", body: "# X\n\nbody", scope: "team", tags: [], paths: [], symbols: [] },
      ctx,
    );
    const out = await memApprove({ id: saved.id }, ctx);
    expect(out.status).toBe("validated");
    const written = await readFile(out.file_path, "utf8");
    expect(written).toContain("validated_by: agent");
  });
});
