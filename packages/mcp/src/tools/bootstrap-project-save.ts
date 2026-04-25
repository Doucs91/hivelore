import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const BootstrapProjectSaveInputSchema = {
  content: z
    .string()
    .min(1)
    .describe("Full Markdown content for the project (or module) context file"),
  module: z
    .string()
    .optional()
    .describe(
      "If provided, save under .ai/modules/<module>/context.md instead of .ai/project-context.md",
    ),
  overwrite: z
    .boolean()
    .default(false)
    .describe("Overwrite an existing file instead of failing"),
};

export type BootstrapProjectSaveInput = {
  [K in keyof typeof BootstrapProjectSaveInputSchema]: z.infer<
    (typeof BootstrapProjectSaveInputSchema)[K]
  >;
};

export interface BootstrapProjectSaveOutput {
  file_path: string;
  action: "created" | "overwritten";
}

export async function bootstrapProjectSave(
  input: BootstrapProjectSaveInput,
  ctx: HaiveContext,
): Promise<BootstrapProjectSaveOutput> {
  const target = input.module
    ? path.join(ctx.paths.modulesContextDir, input.module, "context.md")
    : ctx.paths.projectContext;

  const exists = existsSync(target);
  if (exists && !input.overwrite) {
    throw new Error(
      `${target} already exists. Pass overwrite=true to replace it.`,
    );
  }

  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, input.content, "utf8");

  return {
    file_path: target,
    action: exists ? "overwritten" : "created",
  };
}
