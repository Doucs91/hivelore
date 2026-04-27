import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadMemoriesFromDir, serializeMemory } from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemUpdateInputSchema = {
  id: z.string().min(1).describe("Id of the memory to update"),
  body: z.string().optional().describe("New Markdown body — replaces the existing body"),
  tags: z
    .array(z.string())
    .optional()
    .describe("New tags array — fully replaces existing tags"),
  paths: z
    .array(z.string())
    .optional()
    .describe("New anchor paths — fully replaces existing anchor.paths"),
  symbols: z
    .array(z.string())
    .optional()
    .describe("New anchor symbols — fully replaces existing anchor.symbols"),
  commit: z.string().optional().describe("New anchor commit SHA"),
  domain: z.string().optional().describe("New domain label"),
  author: z.string().optional().describe("New author handle or email"),
};

export type MemUpdateInput = {
  [K in keyof typeof MemUpdateInputSchema]: z.infer<(typeof MemUpdateInputSchema)[K]>;
};

export interface MemUpdateOutput {
  id: string;
  file_path: string;
  updated_fields: string[];
}

export async function memUpdate(
  input: MemUpdateInput,
  ctx: HaiveContext,
): Promise<MemUpdateOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    throw new Error(`No .ai/memories at ${ctx.paths.root}.`);
  }

  const memories = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const loaded = memories.find((m) => m.memory.frontmatter.id === input.id);
  if (!loaded) throw new Error(`No memory with id "${input.id}".`);

  const { frontmatter, body } = loaded.memory;
  const updated_fields: string[] = [];

  const newAnchor = { ...frontmatter.anchor };
  if (input.paths !== undefined) { newAnchor.paths = input.paths; updated_fields.push("anchor.paths"); }
  if (input.symbols !== undefined) { newAnchor.symbols = input.symbols; updated_fields.push("anchor.symbols"); }
  if (input.commit !== undefined) { newAnchor.commit = input.commit; updated_fields.push("anchor.commit"); }

  const newFrontmatter = {
    ...frontmatter,
    anchor: newAnchor,
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.domain !== undefined ? { domain: input.domain } : {}),
    ...(input.author !== undefined ? { author: input.author } : {}),
  };

  if (input.tags !== undefined) updated_fields.push("tags");
  if (input.domain !== undefined) updated_fields.push("domain");
  if (input.author !== undefined) updated_fields.push("author");

  const newBody = input.body !== undefined ? input.body : body;
  if (input.body !== undefined) updated_fields.push("body");

  if (updated_fields.length === 0) {
    throw new Error("No fields to update — provide at least one of: body, tags, paths, symbols, commit, domain, author.");
  }

  await writeFile(
    loaded.filePath,
    serializeMemory({ frontmatter: newFrontmatter, body: newBody }),
    "utf8",
  );

  return { id: input.id, file_path: loaded.filePath, updated_fields };
}
