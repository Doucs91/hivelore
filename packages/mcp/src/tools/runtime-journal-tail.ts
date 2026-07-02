import { readRuntimeJournalTail } from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const RuntimeJournalTailInputSchema = {
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .default(30)
    .describe("Last N journal entries to return"),
};

export type RuntimeJournalTailInput = {
  [K in keyof typeof RuntimeJournalTailInputSchema]: z.infer<
    (typeof RuntimeJournalTailInputSchema)[K]
  >;
};

export async function runtimeJournalTail(
  input: RuntimeJournalTailInput,
  ctx: HaiveContext,
): Promise<{ entries: Awaited<ReturnType<typeof readRuntimeJournalTail>>; empty?: boolean }> {
  const entries = await readRuntimeJournalTail(ctx.paths, input.limit);
  if (entries.length === 0) {
    return { entries: [], empty: true };
  }
  return { entries };
}
