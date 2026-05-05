import { appendRuntimeJournalEntry } from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const RuntimeJournalAppendInputSchema = {
  message: z.string().min(1).describe("Short line to append to the runtime session journal"),
  kind: z.enum(["note", "session_end", "mcp"]).default("note"),
  tool: z.string().optional().describe("When kind=mcp, which tool name (optional)"),
};

export type RuntimeJournalAppendInput = {
  [K in keyof typeof RuntimeJournalAppendInputSchema]: z.infer<
    (typeof RuntimeJournalAppendInputSchema)[K]
  >;
};

export async function runtimeJournalAppend(
  input: RuntimeJournalAppendInput,
  ctx: HaiveContext,
): Promise<{ ok: true; path_hint: string }> {
  await appendRuntimeJournalEntry(ctx.paths, {
    kind: input.kind,
    message: input.message,
    ...(input.tool ? { tool: input.tool } : {}),
  });
  return {
    ok: true,
    path_hint: `${ctx.paths.runtimeDir}/session-journal.ndjson`,
  };
}
