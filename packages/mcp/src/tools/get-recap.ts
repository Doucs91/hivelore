import { existsSync } from "node:fs";
import { loadMemoriesFromDir } from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const GetRecapInputSchema = {
  scope: z
    .enum(["personal", "team", "any"])
    .default("any")
    .describe(
      "Limit to a specific scope's recap. Default 'any' returns the most recent recap " +
      "across both personal and team scopes.",
    ),
};

export type GetRecapInput = {
  [K in keyof typeof GetRecapInputSchema]: z.infer<(typeof GetRecapInputSchema)[K]>;
};

export interface GetRecapOutput {
  recap: {
    id: string;
    scope: string;
    revision_count: number;
    created_at: string;
    body: string;
  } | null;
  notice?: string;
}

/**
 * Lightweight alternative to get_briefing when you ONLY need the previous
 * session recap (e.g. resuming a long task between sessions). Skips project
 * context, modules, and memory ranking — pays only the recap's token cost.
 */
export async function getRecap(
  input: GetRecapInput,
  ctx: HaiveContext,
): Promise<GetRecapOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { recap: null, notice: "No .ai/memories directory — haive not initialized here." };
  }

  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const recaps = all
    .filter(({ memory }) => memory.frontmatter.type === "session_recap")
    .filter(({ memory }) => input.scope === "any" || memory.frontmatter.scope === input.scope)
    .sort(
      (a, b) =>
        new Date(b.memory.frontmatter.created_at).getTime() -
        new Date(a.memory.frontmatter.created_at).getTime(),
    );

  if (recaps.length === 0) {
    return {
      recap: null,
      notice:
        input.scope === "any"
          ? "No session recap saved yet. Run mem_session_end (or post_task prompt) to capture one."
          : `No session recap found in scope '${input.scope}'.`,
    };
  }

  const r = recaps[0]!;
  const fm = r.memory.frontmatter;
  return {
    recap: {
      id: fm.id,
      scope: fm.scope,
      revision_count: fm.revision_count ?? 0,
      created_at: fm.created_at,
      body: r.memory.body,
    },
  };
}
