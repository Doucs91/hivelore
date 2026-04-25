import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const GetProjectContextInputSchema = {
  module: z
    .string()
    .optional()
    .describe("If provided, also include the matching module's context file"),
  list_modules: z
    .boolean()
    .default(false)
    .describe("Return the list of available module context files"),
};

export type GetProjectContextInput = {
  [K in keyof typeof GetProjectContextInputSchema]: z.infer<
    (typeof GetProjectContextInputSchema)[K]
  >;
};

export interface GetProjectContextOutput {
  root_context: string | null;
  module_context?: { name: string; content: string };
  available_modules?: string[];
}

export async function getProjectContext(
  input: GetProjectContextInput,
  ctx: HaiveContext,
): Promise<GetProjectContextOutput> {
  const out: GetProjectContextOutput = { root_context: null };

  if (existsSync(ctx.paths.projectContext)) {
    out.root_context = await readFile(ctx.paths.projectContext, "utf8");
  }

  if (input.module) {
    const modFile = path.join(ctx.paths.modulesContextDir, input.module, "context.md");
    if (existsSync(modFile)) {
      out.module_context = {
        name: input.module,
        content: await readFile(modFile, "utf8"),
      };
    }
  }

  if (input.list_modules) {
    out.available_modules = await listModules(ctx.paths.modulesContextDir);
  }

  return out;
}

async function listModules(modulesDir: string): Promise<string[]> {
  if (!existsSync(modulesDir)) return [];
  const entries = await readdir(modulesDir, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}
