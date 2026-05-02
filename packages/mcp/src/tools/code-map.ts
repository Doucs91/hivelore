import { estimateTokens, loadCodeMap, queryCodeMap } from "@hiveai/core";
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
  paths: z
    .array(z.string())
    .default([])
    .describe(
      "Filter to files under any of these path prefixes (e.g. ['packages/mcp/src/tools/', 'src/auth/']). " +
      "OR-joined with `file` substring; useful to get a focused view of one module.",
    ),
  max_files: z
    .number()
    .int()
    .positive()
    .default(40)
    .describe("Cap on returned files (hard limit, applied after token budget)"),
  max_tokens: z
    .number()
    .int()
    .positive()
    .optional()
    .describe(
      "Approximate token budget for the response. When the matching set exceeds it, " +
      "files are ranked by export density (exports per LOC) and the highest-signal ones are kept first. " +
      "Omit to disable budgeting (legacy behavior).",
    ),
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
  /** Number of matched files dropped due to max_files / max_tokens. */
  truncated?: number;
  /** True when at least one file was dropped to fit the token budget. */
  budget_clipped?: true;
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
  const { files: matched } = queryCodeMap(map, { file: input.file, symbol: input.symbol });

  // Apply `paths` prefix filter on top of the substring match (OR within paths, AND with file).
  const pathsFiltered = input.paths.length === 0
    ? matched
    : matched.filter((f) => input.paths.some((p) => f.path.startsWith(stripLeadingSlash(p))));

  // Default order: alphabetical by path (predictable for callers).
  const alphabetical = [...pathsFiltered].sort((a, b) => a.path.localeCompare(b.path));

  let kept = alphabetical;
  let budgetClipped = false;
  if (input.max_tokens !== undefined) {
    // Density-rank to PICK which files to KEEP under budget, then re-sort alphabetically for output.
    const byDensity = [...alphabetical].sort((a, b) => {
      const da = density(a.entry.exports.length, a.entry.loc);
      const db = density(b.entry.exports.length, b.entry.loc);
      if (da !== db) return db - da;
      return a.path.localeCompare(b.path);
    });
    const keepSet = new Set<string>();
    let spent = 0;
    for (const f of byDensity) {
      const cost = estimateFileEntryTokens(f);
      if (spent + cost > input.max_tokens && keepSet.size > 0) {
        budgetClipped = true;
        break;
      }
      keepSet.add(f.path);
      spent += cost;
    }
    if (budgetClipped) {
      kept = alphabetical.filter((f) => keepSet.has(f.path));
    }
  }

  const finalFiles = kept.slice(0, input.max_files);
  const totalDropped = pathsFiltered.length - finalFiles.length;

  return {
    available: true,
    generated_at: map.generated_at,
    total_files: Object.keys(map.files).length,
    files: finalFiles.map((f) => ({
      path: f.path,
      ...(f.entry.summary ? { summary: f.entry.summary } : {}),
      loc: f.entry.loc,
      exports: f.entry.exports,
    })),
    ...(totalDropped > 0 ? { truncated: totalDropped } : {}),
    ...(budgetClipped ? { budget_clipped: true as const } : {}),
  };
}

function density(exports: number, loc: number): number {
  if (loc <= 0) return 0;
  return exports / Math.max(loc, 1);
}

function stripLeadingSlash(p: string): string {
  return p.startsWith("/") ? p.slice(1) : p;
}

function estimateFileEntryTokens(f: { path: string; entry: { summary?: string; loc: number; exports: Array<{ name: string; kind: string; description?: string; line: number }> } }): number {
  // Rough payload size: path + summary + each export (~6 tokens for name+kind+line + description).
  const exportsCost = f.entry.exports.reduce(
    (acc, e) => acc + 6 + estimateTokens(e.description ?? ""),
    0,
  );
  return estimateTokens(f.path) + estimateTokens(f.entry.summary ?? "") + exportsCost + 4;
}
