/**
 * mem_session_end — save a structured end-of-session recap.
 *
 * Engram-inspired: explicit session lifecycle lets the next session start with
 * rich context about what was just done, which files were touched, and what
 * remains. Uses topic-upsert so there is always exactly ONE "current recap"
 * per scope/module: revisions accumulate in-place rather than creating clutter.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  loadTaskSession, saveTaskSession, sessionIdentity,
  buildFrontmatter,
  buildRecapWithHistory,
  loadConfig,
  loadMemoriesFromDir,
  writeSessionHandoff,
  memoryFilePath,
  serializeMemory,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";
import { clearPendingDistill } from "../session-tracker.js";

export const MemSessionEndInputSchema = {
  session_id: z.string().optional().describe("Task session to checkpoint independently of the rolling recap."),
  goal: z
    .string()
    .min(1)
    .describe("What you were trying to accomplish this session (1–2 sentences)"),
  accomplished: z
    .string()
    .describe("What was actually done — bullet list recommended"),
  discoveries: z
    .string()
    .default("")
    .describe(
      "Any bugs, inconsistencies, surprises, or missing knowledge found during this session. " +
      "Empty if nothing surprising was found.",
    ),
  files_touched: z
    .array(z.string())
    .default([])
    .describe("Key files that were read or modified — used as anchor paths"),
  next_steps: z
    .string()
    .default("")
    .describe("What should happen next (for the next session or a teammate)"),
  scope: z
    .enum(["personal", "team", "module"])
    .default("personal")
    .describe("Visibility: personal = private to you, team = shared with the team"),
  module: z
    .string()
    .optional()
    .describe("Module name (required when scope=module)"),
};

export type MemSessionEndInput = {
  [K in Exclude<keyof typeof MemSessionEndInputSchema, "session_id">]: z.infer<(typeof MemSessionEndInputSchema)[K]>;
} & { session_id?: string };

export interface MemSessionEndOutput {
  id: string;
  scope: string;
  file_path: string;
  /** "handoff" = written to the local NEXT.md, not to the memory corpus (autoSessionRecap=false). */
  action: "created" | "updated" | "handoff";
  revision_count: number;
  notice?: string;
}

const RECAP_IS_LOCAL =
  "Session recaps are a local handoff, never shared corpus: a recap rewritten every session became a " +
  "172-revision log that topped every briefing (field reports #9 §4, #12 §3.2). Durable lessons go in " +
  "mem_save / mem_tried; what was done is in the commits and the PR description.";

/** Stable topic key for upsert — one recap per scope/module. */
function recapTopic(scope: string, module?: string): string {
  return module ? `session-recap-${scope}-${module}` : `session-recap-${scope}`;
}

function buildBody(input: MemSessionEndInput): string {
  const lines: string[] = [];

  lines.push(`## Goal\n${input.goal}`);
  lines.push(`\n## Accomplished\n${input.accomplished}`);

  if (input.discoveries.trim()) {
    lines.push(`\n## Discoveries & surprises\n${input.discoveries}`);
  }

  if (input.files_touched.length > 0) {
    lines.push(`\n## Files touched\n${input.files_touched.map((f) => `- \`${f}\``).join("\n")}`);
  }

  if (input.next_steps.trim()) {
    lines.push(`\n## Next steps\n${input.next_steps}`);
  }

  return lines.join("\n");
}

export async function memSessionEnd(
  input: MemSessionEndInput,
  ctx: HaiveContext,
): Promise<MemSessionEndOutput> {
  if (!existsSync(ctx.paths.haiveDir)) {
    throw new Error(`No .ai/ directory at ${ctx.paths.root}. Run 'hivelore init' first.`);
  }

  const sessionId = sessionIdentity(input.session_id ?? ctx.sessionId);
  const session = await loadTaskSession(ctx.paths, sessionId);
  if (session) await saveTaskSession(ctx.paths, { ...session, task: input.goal, accomplished: input.accomplished, next_steps: input.next_steps }, sessionId);
  // The repo opted out of recap memories: an explicit call writes the ephemeral handoff instead,
  // so the agent following an old instruction cannot reintroduce what the team removed.
  const config = await loadConfig(ctx.paths).catch(() => null);
  if (config?.autoSessionRecap === false) {
    const openThreads = input.discoveries
      .split("\n")
      .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean)
      .slice(0, 5);
    const file = await writeSessionHandoff(ctx.paths.root, {
      goal: input.goal,
      summary: input.accomplished,
      ...(openThreads.length ? { openThreads } : {}),
      filesTouched: input.files_touched,
      nextSteps: input.next_steps,
    });
    await clearPendingDistill(ctx);
    return {
      id: "handoff",
      scope: "local",
      file_path: file,
      action: "handoff",
      revision_count: 0,
      notice: "This repo keeps no recap memories (autoSessionRecap=false): wrote the local NEXT.md handoff. " + RECAP_IS_LOCAL,
    };
  }
  let scopeNotice: string | undefined;
  if (input.scope !== "personal") {
    scopeNotice = `Requested scope '${input.scope}' was saved as personal (machine-local, gitignored). ${RECAP_IS_LOCAL}`;
    input = { ...input, scope: "personal", module: undefined };
  }
  const body = buildBody(input);
  const topic = recapTopic(input.scope, input.module);

  // Normalize to project-relative paths (guards against absolute paths from agents)
  const normalizedFiles = input.files_touched.map((p) => {
    if (!p || !path.isAbsolute(p)) return p;
    const rel = path.relative(ctx.paths.root, p);
    return rel.startsWith("..") ? p : rel;
  });

  // Validate anchor paths exist before saving
  const invalidPaths = normalizedFiles.filter(
    (p) => !existsSync(path.resolve(ctx.paths.root, p)),
  );
  if (invalidPaths.length > 0) {
    // Non-blocking for session end — just log in the output
    console.warn(`[haive] session end: anchor path(s) not found: ${invalidPaths.join(", ")}`);
  }

  const existing = existsSync(ctx.paths.memoriesDir)
    ? await loadMemoriesFromDir(ctx.paths.memoriesDir)
    : [];

  // ── Topic upsert: update existing recap in-place ───────────────────────
  const topicMatch = existing.find(({ memory }) =>
    memory.frontmatter.topic === topic &&
    memory.frontmatter.scope === input.scope &&
    (!input.module || memory.frontmatter.module === input.module),
  );

  if (topicMatch) {
    const fm = topicMatch.memory.frontmatter;
    const revisionCount = (fm.revision_count ?? 0) + 1;
    // A recap is never anchored to files: anchors turned it into "team policy" injected on unrelated
    // edits of the listed files (field report #9 §3). The file list stays in the body.
    const newFrontmatter = {
      ...fm,
      // For a recap this is "last written" — briefings compute the recap's age from it.
      verified_at: new Date().toISOString(),
      revision_count: revisionCount,
      anchor: { ...fm.anchor, paths: [] },
    };
    // Archive the outgoing recap into a bounded per-session history instead of overwriting it (§5.6).
    const combinedBody = buildRecapWithHistory(body, topicMatch.memory.body, fm.verified_at ?? fm.created_at);
    await writeFile(
      topicMatch.filePath,
      serializeMemory({ frontmatter: newFrontmatter, body: combinedBody }),
      "utf8",
    );
    // Clear pending distill — a manual post_task flow completed successfully.
    await clearPendingDistill(ctx);
    return {
      id: fm.id,
      scope: fm.scope,
      file_path: topicMatch.filePath,
      action: "updated",
      revision_count: revisionCount,
      ...(scopeNotice ? { notice: scopeNotice } : {}),
    };
  }

  // ── Create new recap (first session) ──────────────────────────────────
  const frontmatter = buildFrontmatter({
    type: "session_recap",
    slug: "recap",
    scope: input.scope,
    module: input.module,
    tags: ["session", "recap"],
    topic,
    status: "validated",
  });

  const file = memoryFilePath(
    ctx.paths,
    frontmatter.scope,
    frontmatter.id,
    frontmatter.module,
  );
  await mkdir(path.dirname(file), { recursive: true });

  await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");

  // A successful manual mem_session_end (post_task flow) means the distillation
  // has been done properly — clear the shallow auto-recap marker so the next
  // get_briefing doesn't ask again.
  await clearPendingDistill(ctx);

  return {
    id: frontmatter.id,
    scope: frontmatter.scope,
    file_path: file,
    action: "created",
    revision_count: 0,
    ...(scopeNotice ? { notice: scopeNotice } : {}),
  };
}
