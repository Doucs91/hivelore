import { loadCodeMap, queryCodeMap } from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const CodeMapInputSchema = {
  file: z
    .string()
    .optional()
    .describe("Filter to files whose path contains this substring"),
  symbol: z
    .string()
    .optional()
    .describe("Filter to files exporting a symbol whose name contains this substring"),
  max_files: z
    .number()
    .int()
    .positive()
    .default(40)
    .describe("Cap on returned files"),
};

export type CodeMapInput = {
  [K in keyof typeof CodeMapInputSchema]: z.infer<(typeof CodeMapInputSchema)[K]>;
};

export interface CodeMapToolOutput {
  available: boolean;
  generated_at?: string;
  total_files?: number;
  files: Array<{
    path: string;
    summary?: string;
    loc: number;
    exports: Array<{ name: string; kind: string; description?: string; line: number }>;
  }>;
  notice?: string;
}

export async function codeMapTool(
  input: CodeMapInput,
  ctx: HaiveContext,
): Promise<CodeMapToolOutput> {
  const map = await loadCodeMap(ctx.paths);
  if (!map) {
    return {
      available: false,
      files: [],
      notice: "No code map found. Run `haive index code` to generate `.ai/code-map.json`.",
    };
  }
  const { files } = queryCodeMap(map, { file: input.file, symbol: input.symbol });
  return {
    available: true,
    generated_at: map.generated_at,
    total_files: Object.keys(map.files).length,
    files: files.slice(0, input.max_files).map((f) => ({
      path: f.path,
      ...(f.entry.summary ? { summary: f.entry.summary } : {}),
      loc: f.entry.loc,
      exports: f.entry.exports,
    })),
  };
}
