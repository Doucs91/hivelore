import { z } from "zod";
import { loadCodeMap } from "@hiveai/core";
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
  /** True when the embeddings index was built from an older code-map — results may miss new/moved symbols. */
  stale?: true;
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

  // Flag (don't hide) a stale index: the code-map was rebuilt after the embeddings index, so newly
  // added or moved symbols may be missing/mislocated. Best-effort — never fail the search over this.
  let stale = false;
  try {
    const codeMap = await loadCodeMap(ctx.paths);
    if (codeMap) stale = mod.isCodeIndexStale(result.index.source_generated_at, codeMap.generated_at);
  } catch {
    // ignore — staleness is advisory
  }

  return {
    available: true,
    hits: result.hits,
    ...(stale
      ? {
          stale: true as const,
          notice:
            "Code-search index is stale (built from an older code-map); newly added or moved symbols " +
            "may be missing or mislocated. Rebuild with `haive index code && haive index code-search`.",
        }
      : {}),
  };
}
