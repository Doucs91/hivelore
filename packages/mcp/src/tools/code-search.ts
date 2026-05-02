import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const CodeSearchInputSchema = {
  query: z
    .string()
    .min(1)
    .describe(
      "Natural-language description of what you are looking for in the codebase " +
      "(e.g. 'function that hashes passwords', 'JWT signing logic', 'route registration').",
    ),
  k: z
    .number()
    .int()
    .positive()
    .max(50)
    .default(5)
    .describe("Number of top hits to return."),
  min_score: z
    .number()
    .min(0)
    .max(1)
    .default(0.2)
    .describe(
      "Minimum cosine similarity. Hits below this threshold are dropped to avoid noise. " +
      "Try 0.3+ for stricter matching.",
    ),
};

export type CodeSearchInput = {
  [K in keyof typeof CodeSearchInputSchema]: z.infer<(typeof CodeSearchInputSchema)[K]>;
};

export interface CodeSearchHit {
  file: string;
  name: string;
  kind: string;
  line: number;
  description?: string;
  score: number;
}

export interface CodeSearchOutput {
  available: boolean;
  hits: CodeSearchHit[];
  notice?: string;
}

export async function codeSearch(
  input: CodeSearchInput,
  ctx: HaiveContext,
): Promise<CodeSearchOutput> {
  let mod: typeof import("@hiveai/embeddings");
  try {
    mod = await import("@hiveai/embeddings");
  } catch {
    return {
      available: false,
      hits: [],
      notice:
        "@hiveai/embeddings is not installed. Install it (`pnpm add @hiveai/embeddings`) " +
        "and run `haive index code-search` to enable semantic code search.",
    };
  }

  const result = await mod.codeSemanticSearch(ctx.paths, input.query, {
    limit: input.k,
    minScore: input.min_score,
  });

  if (!result) {
    return {
      available: false,
      hits: [],
      notice:
        "Code semantic-search index not built. Run `haive index code-search` to generate it " +
        "(builds embeddings for every exported symbol in the code-map).",
    };
  }

  return { available: true, hits: result.hits };
}
