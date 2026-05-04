import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildFrontmatter,
  loadConfig,
  loadMemoriesFromDir,
  memoryFilePath,
  serializeMemory,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemSaveInputSchema = {
  type: z
    .enum(["convention", "decision", "gotcha", "architecture", "glossary", "attempt", "session_recap"])
    .describe(
      "Kind of memory being saved. Use 'attempt' for failed approaches (auto-validated). " +
      "Use 'session_recap' via mem_session_end instead.",
    ),
  slug: z
    .string()
    .min(1)
    .describe("Short human-readable identifier — becomes part of the filename"),
  body: z
    .string()
    .describe("Markdown body of the memory"),
  scope: z
    .enum(["personal", "team", "module"])
    .optional()
    .describe(
      "Visibility scope: personal | team | module. " +
      "When omitted, falls back to defaultScope in haive.config.json (default: personal).",
    ),
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
  topic: z
    .string()
    .optional()
    .describe(
      "Stable key for this memory. If a memory with the same topic already exists in this scope, " +
      "it is updated in-place (revision_count++). Use for knowledge that evolves over time.",
    ),
};

export type MemSaveInput = {
  [K in keyof typeof MemSaveInputSchema]: z.infer<(typeof MemSaveInputSchema)[K]>;
};

export interface MemSaveOutput {
  id: string;
  scope: string;
  file_path: string;
  action: "created" | "updated";
  revision_count?: number;
  warning?: string;
  similar_found?: string[];
  invalid_paths?: string[];
}

function bodyHash(body: string): string {
  return createHash("sha256").update(body.trim()).digest("hex").slice(0, 12);
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

  const existing = existsSync(ctx.paths.memoriesDir)
    ? await loadMemoriesFromDir(ctx.paths.memoriesDir)
    : [];

  // ── Resolve scope once: explicit input wins over config default ────────
  // Must be computed early so dedup and topic-upsert use the same scope
  // that the new memory will ultimately be saved under.
  const haiveConfig = await loadConfig(ctx.paths);
  const resolvedScope = (
    input.scope ?? haiveConfig.defaultScope ?? "personal"
  ) as "personal" | "team" | "module";

  // ── Anchor path validation ─────────────────────────────────────────────
  const invalidPaths = input.paths.filter(
    (p) => !existsSync(path.resolve(ctx.paths.root, p)),
  );

  // ── Dedup by content hash ──────────────────────────────────────────────
  const incomingHash = bodyHash(input.body);
  const hashDuplicate = existing.find(({ memory }) =>
    bodyHash(memory.body) === incomingHash &&
    memory.frontmatter.scope === resolvedScope,
  );
  if (hashDuplicate) {
    throw new Error(
      `Duplicate content detected — identical body already saved as "${hashDuplicate.memory.frontmatter.id}". ` +
      `Use mem_update to modify it, or change the body to add new information.`,
    );
  }

  // ── Topic upsert ───────────────────────────────────────────────────────
  if (input.topic) {
    const topicMatch = existing.find(({ memory }) =>
      memory.frontmatter.topic === input.topic &&
      memory.frontmatter.scope === resolvedScope &&
      (!input.module || memory.frontmatter.module === input.module),
    );

    if (topicMatch) {
      const fm = topicMatch.memory.frontmatter;
      const newFrontmatter = {
        ...fm,
        body: input.body,
        tags: input.tags.length ? input.tags : fm.tags,
        revision_count: (fm.revision_count ?? 0) + 1,
        anchor: {
          commit: input.commit ?? fm.anchor.commit,
          paths: input.paths.length ? input.paths : fm.anchor.paths,
          symbols: input.symbols.length ? input.symbols : fm.anchor.symbols,
        },
      };
      await writeFile(
        topicMatch.filePath,
        serializeMemory({ frontmatter: newFrontmatter, body: input.body }),
        "utf8",
      );
      return {
        id: fm.id,
        scope: fm.scope,
        file_path: topicMatch.filePath,
        action: "updated",
        revision_count: newFrontmatter.revision_count,
        ...(invalidPaths.length > 0 ? { invalid_paths: invalidPaths, warning: `Anchor path(s) not found in project: ${invalidPaths.join(", ")}. They will be marked stale by haive sync.` } : {}),
      };
    }
  }

  // ── Create new memory ──────────────────────────────────────────────────
  // resolvedScope and haiveConfig are already computed above.

  const frontmatter = buildFrontmatter({
    type: input.type,
    slug: input.slug,
    scope: resolvedScope,
    module: input.module,
    tags: input.tags,
    domain: input.domain,
    author: input.author,
    paths: input.paths,
    symbols: input.symbols,
    commit: input.commit,
    topic: input.topic,
    status: haiveConfig.defaultStatus === "validated" ? "validated" : undefined,
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

  // ── Similar slug detection (warn but don't block) ──────────────────────
  let warning: string | undefined;
  let similar_found: string[] | undefined;
  if (existing.length > 0) {
    const slugTokens = input.slug.toLowerCase().split(/[-_\s]+/).filter(Boolean);
    const similar = existing.filter(({ memory }) => {
      const id = memory.frontmatter.id.toLowerCase();
      return (
        slugTokens.length >= 2 &&
        slugTokens.filter((t) => id.includes(t)).length >= Math.ceil(slugTokens.length * 0.6)
      );
    });
    if (similar.length > 0) {
      similar_found = similar.map((m) => m.memory.frontmatter.id);
      warning = `Possible duplicate: similar memories already exist (${similar_found.join(", ")}). Consider updating one of these instead.`;
    }
  }

  await writeFile(file, serializeMemory({ frontmatter, body: input.body }), "utf8");

  // Merge invalid_paths warning with slug similarity warning
  const finalWarning = [
    invalidPaths.length > 0
      ? `Anchor path(s) not found in project: ${invalidPaths.join(", ")}. They will be marked stale by \`haive sync\`.`
      : null,
    warning ?? null,
  ].filter(Boolean).join(" — ") || undefined;

  return {
    id: frontmatter.id,
    scope: frontmatter.scope,
    file_path: file,
    action: "created",
    ...(finalWarning ? { warning: finalWarning } : {}),
    ...(similar_found ? { similar_found } : {}),
    ...(invalidPaths.length > 0 ? { invalid_paths: invalidPaths } : {}),
  };
}
