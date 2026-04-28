import { existsSync } from "node:fs";
import { loadMemoriesFromDir } from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemDiffInputSchema = {
  id_a: z.string().min(1).describe("First memory id"),
  id_b: z.string().min(1).describe("Second memory id"),
};

export type MemDiffInput = {
  [K in keyof typeof MemDiffInputSchema]: z.infer<(typeof MemDiffInputSchema)[K]>;
};

export interface MemDiffOutput {
  id_a: string;
  id_b: string;
  frontmatter_diff: Record<string, { a: unknown; b: unknown }>;
  body_diff: {
    lines_only_in_a: string[];
    lines_only_in_b: string[];
    common_lines: number;
  };
}

export async function memDiff(input: MemDiffInput, ctx: HaiveContext): Promise<MemDiffOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    throw new Error(`No .ai/memories at ${ctx.paths.root}.`);
  }
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const foundA = all.find((m) => m.memory.frontmatter.id === input.id_a);
  const foundB = all.find((m) => m.memory.frontmatter.id === input.id_b);
  if (!foundA) throw new Error(`No memory with id "${input.id_a}".`);
  if (!foundB) throw new Error(`No memory with id "${input.id_b}".`);

  const fmA = foundA.memory.frontmatter as Record<string, unknown>;
  const fmB = foundB.memory.frontmatter as Record<string, unknown>;

  const frontmatterDiff: Record<string, { a: unknown; b: unknown }> = {};
  const allKeys = new Set([...Object.keys(fmA), ...Object.keys(fmB)]);
  for (const key of allKeys) {
    const va = fmA[key];
    const vb = fmB[key];
    if (JSON.stringify(va) !== JSON.stringify(vb)) {
      frontmatterDiff[key] = { a: va, b: vb };
    }
  }

  const linesA = new Set(foundA.memory.body.split("\n").map((l) => l.trim()).filter(Boolean));
  const linesB = new Set(foundB.memory.body.split("\n").map((l) => l.trim()).filter(Boolean));

  const onlyA = [...linesA].filter((l) => !linesB.has(l));
  const onlyB = [...linesB].filter((l) => !linesA.has(l));
  const common = [...linesA].filter((l) => linesB.has(l)).length;

  return {
    id_a: input.id_a,
    id_b: input.id_b,
    frontmatter_diff: frontmatterDiff,
    body_diff: {
      lines_only_in_a: onlyA,
      lines_only_in_b: onlyB,
      common_lines: common,
    },
  };
}
