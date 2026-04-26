import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildFrontmatter,
  memoryFilePath,
  serializeMemory,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemSaveInputSchema = {
  type: z
    .enum(["convention", "decision", "gotcha", "architecture", "glossary"])
    .describe("Kind of memory being saved"),
  slug: z
    .string()
    .min(1)
    .describe("Short human-readable identifier — becomes part of the filename"),
  body: z
    .string()
    .describe("Markdown body of the memory"),
  scope: z
    .enum(["personal", "team", "module"])
    .default("personal")
    .describe("Visibility scope: personal | team | module"),
  module: z
    .string()
    .optional()
    .describe("Module name (required when scope=module)"),
  tags: z.array(z.string()).default([]).describe("Tags for filtering"),
  domain: z.string().optional().describe("Domain (e.g. transactions, billing)"),
  author: z.string().optional().describe("Author handle or email"),
  paths: z
    .array(z.string())
    .default([])
    .describe("Anchor paths (file paths this memory references)"),
  symbols: z
    .array(z.string())
    .default([])
    .describe("Anchor symbols (function/class names this memory references)"),
  commit: z
    .string()
    .optional()
    .describe("Anchor commit SHA (for staleness detection later)"),
};

export type MemSaveInput = {
  [K in keyof typeof MemSaveInputSchema]: z.infer<(typeof MemSaveInputSchema)[K]>;
};

export interface MemSaveOutput {
  id: string;
  scope: string;
  file_path: string;
}

export async function memSave(
  input: MemSaveInput,
  ctx: HaiveContext,
): Promise<MemSaveOutput> {
  if (!existsSync(ctx.paths.haiveDir)) {
    throw new Error(
      `No .ai/ directory at ${ctx.paths.root}. Run 'haive init' first.`,
    );
  }

  const frontmatter = buildFrontmatter({
    type: input.type,
    slug: input.slug,
    scope: input.scope,
    module: input.module,
    tags: input.tags,
    domain: input.domain,
    author: input.author,
    paths: input.paths,
    symbols: input.symbols,
    commit: input.commit,
  });

  const file = memoryFilePath(
    ctx.paths,
    frontmatter.scope,
    frontmatter.id,
    frontmatter.module,
  );
  await mkdir(path.dirname(file), { recursive: true });

  if (existsSync(file)) {
    throw new Error(`Memory already exists at ${file}`);
  }

  await writeFile(file, serializeMemory({ frontmatter, body: input.body }), "utf8");

  return {
    id: frontmatter.id,
    scope: frontmatter.scope,
    file_path: file,
  };
}
