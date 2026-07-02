import { resolveProjectInfo } from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

/** Input is intentionally minimal — callers may pass cwd for multi-root clients. */
export const MemResolveProjectInputSchema = {
  cwd: z
    .string()
    .optional()
    .describe("Directory used for root discovery when HAIVE_PROJECT_ROOT is unset."),
};

export type MemResolveProjectInput = {
  [K in keyof typeof MemResolveProjectInputSchema]: z.infer<(typeof MemResolveProjectInputSchema)[K]>;
};

export async function memResolveProject(
  input: MemResolveProjectInput,
  _ctx: HaiveContext,
): Promise<{ info: ReturnType<typeof resolveProjectInfo>; ok: true }> {
  void _ctx;
  return {
    ok: true,
    info: resolveProjectInfo({
      cwd: input.cwd,
    }),
  };
}
