import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  loadMemoriesFromDir,
  serializeMemory,
  verifyAnchor,
  type Memory,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemVerifyInputSchema = {
  id: z.string().optional().describe("If set, verify only this memory id"),
  update: z
    .boolean()
    .default(false)
    .describe("Write the resulting status back to disk (status=stale or validated)"),
};

export type MemVerifyInput = {
  [K in keyof typeof MemVerifyInputSchema]: z.infer<(typeof MemVerifyInputSchema)[K]>;
};

export interface MemVerifyHit {
  id: string;
  file_path: string;
  stale: boolean;
  reason: string | null;
  possible_renames?: string[];
  status_after: string;
  skipped?: boolean;
}

export interface MemVerifyOutput {
  results: MemVerifyHit[];
  summary: {
    checked: number;
    fresh: number;
    stale: number;
    anchorless_skipped: number;
    updated: number;
  };
}

export async function memVerify(
  input: MemVerifyInput,
  ctx: HaiveContext,
): Promise<MemVerifyOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return {
      results: [],
      summary: { checked: 0, fresh: 0, stale: 0, anchorless_skipped: 0, updated: 0 },
    };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const targets = input.id
    ? all.filter((m) => m.memory.frontmatter.id === input.id)
    : all;

  const results: MemVerifyHit[] = [];
  let fresh = 0;
  let stale = 0;
  let anchorless = 0;
  let updated = 0;

  for (const { memory, filePath } of targets) {
    // session_recap records historical context — anchor staleness does not apply
    if (memory.frontmatter.type === "session_recap") {
      anchorless++;
      results.push({
        id: memory.frontmatter.id,
        file_path: filePath,
        stale: false,
        reason: null,
        status_after: memory.frontmatter.status,
        skipped: true,
      });
      continue;
    }
    const isAnchored =
      memory.frontmatter.anchor.paths.length > 0 ||
      memory.frontmatter.anchor.symbols.length > 0;
    if (!isAnchored) {
      anchorless++;
      results.push({
        id: memory.frontmatter.id,
        file_path: filePath,
        stale: false,
        reason: null,
        status_after: memory.frontmatter.status,
        skipped: true,
      });
      continue;
    }
    const result = await verifyAnchor(memory, { projectRoot: ctx.paths.root });
    if (result.stale) stale++;
    else fresh++;

    let statusAfter = memory.frontmatter.status;
    if (input.update) {
      const next = applyVerification(memory, result);
      await writeFile(filePath, serializeMemory(next), "utf8");
      statusAfter = next.frontmatter.status;
      updated++;
    }

    results.push({
      id: memory.frontmatter.id,
      file_path: filePath,
      stale: result.stale,
      reason: result.reason,
      ...(result.possibleRenames.length > 0 ? { possible_renames: result.possibleRenames } : {}),
      status_after: statusAfter,
    });
  }

  return {
    results,
    summary: {
      checked: results.length + anchorless,
      fresh,
      stale,
      anchorless_skipped: anchorless,
      updated,
    },
  };
}

function applyVerification(
  mem: Memory,
  result: { stale: boolean; reason: string | null },
): Memory {
  const verifiedAt = new Date().toISOString();
  if (result.stale) {
    return {
      frontmatter: {
        ...mem.frontmatter,
        status: "stale",
        verified_at: verifiedAt,
        stale_reason: result.reason,
      },
      body: mem.body,
    };
  }
  const nextStatus =
    mem.frontmatter.status === "stale" || mem.frontmatter.status === "draft"
      ? "validated"
      : mem.frontmatter.status;
  return {
    frontmatter: {
      ...mem.frontmatter,
      status: nextStatus,
      verified_at: verifiedAt,
      stale_reason: null,
    },
    body: mem.body,
  };
}
