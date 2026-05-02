import { loadCodeMap, type HaivePaths } from "@hiveai/core";
import { createHash } from "node:crypto";
import type { EmbedderLike } from "./embedder.js";
import {
  buildCodeEntryText,
  emptyCodeIndex,
  loadCodeIndex,
  saveCodeIndex,
  type CodeEmbeddingEntry,
  type CodeEmbeddingIndex,
} from "./code-index-cache.js";

export interface CodeIndexUpdateReport {
  total: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
}

function hashEntry(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 32);
}

/**
 * Build (or refresh) the code semantic-search index from the code-map.
 * Each exported symbol becomes one embedding entry — granularity stays at the
 * symbol level so search returns a precise file:line:name target.
 *
 * Re-uses entries whose embedded text is unchanged (hash check) so subsequent
 * builds only embed the diff.
 */
export async function rebuildCodeIndex(
  paths: HaivePaths,
  embedder: EmbedderLike,
): Promise<{ index: CodeEmbeddingIndex; report: CodeIndexUpdateReport }> {
  const codeMap = await loadCodeMap(paths);
  if (!codeMap) {
    throw new Error(
      "No code-map found. Run `haive index code` to generate `.ai/code-map.json` first.",
    );
  }

  const existing =
    (await loadCodeIndex(paths)) ??
    emptyCodeIndex(embedder.model, embedder.dimension, codeMap.generated_at);

  if (existing.model !== embedder.model || existing.dimension !== embedder.dimension) {
    existing.entries = [];
    existing.model = embedder.model;
    existing.dimension = embedder.dimension;
  }

  const byId = new Map(existing.entries.map((e) => [e.id, e]));
  const nextEntries: CodeEmbeddingEntry[] = [];
  const seenIds = new Set<string>();
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const [filePath, fileEntry] of Object.entries(codeMap.files)) {
    for (const exp of fileEntry.exports) {
      const id = `${filePath}#${exp.name}`;
      seenIds.add(id);
      const text = buildCodeEntryText(filePath, exp.name, exp.kind, exp.description);
      const hash = hashEntry(text);
      const prior = byId.get(id);

      if (prior && prior.hash === hash && prior.line === exp.line) {
        nextEntries.push({ ...prior, file: filePath, name: exp.name, kind: exp.kind, line: exp.line, ...(exp.description ? { description: exp.description } : {}) });
        unchanged++;
        continue;
      }

      const vector = Array.from(await embedder.encode(text));
      nextEntries.push({
        id,
        file: filePath,
        name: exp.name,
        kind: exp.kind,
        line: exp.line,
        ...(exp.description ? { description: exp.description } : {}),
        hash,
        vector,
      });
      if (prior) updated++;
      else added++;
    }
  }

  const removed = existing.entries.filter((e) => !seenIds.has(e.id)).length;
  existing.entries = nextEntries;
  existing.source_generated_at = codeMap.generated_at;
  await saveCodeIndex(paths, existing);

  return {
    index: existing,
    report: {
      total: nextEntries.length,
      added,
      updated,
      unchanged,
      removed,
    },
  };
}
