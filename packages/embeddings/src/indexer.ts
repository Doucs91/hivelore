import { loadMemoriesFromDir, type HaivePaths } from "@haive/core";
import type { EmbedderLike } from "./embedder.js";
import {
  buildEntryText,
  emptyIndex,
  hashContent,
  loadIndex,
  saveIndex,
  type EmbeddingEntry,
  type EmbeddingIndex,
} from "./index-cache.js";

export interface IndexUpdateReport {
  total: number;
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
}

export async function rebuildIndex(
  paths: HaivePaths,
  embedder: EmbedderLike,
): Promise<{ index: EmbeddingIndex; report: IndexUpdateReport }> {
  const existing = (await loadIndex(paths)) ?? emptyIndex(embedder.model, embedder.dimension);
  // If model changed, reset.
  if (existing.model !== embedder.model || existing.dimension !== embedder.dimension) {
    existing.entries = [];
    existing.model = embedder.model;
    existing.dimension = embedder.dimension;
  }

  const memories = await loadMemoriesFromDir(paths.memoriesDir);
  const byId = new Map(existing.entries.map((e) => [e.id, e]));
  const seenIds = new Set<string>();

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  const nextEntries: EmbeddingEntry[] = [];

  for (const { memory, filePath } of memories) {
    const id = memory.frontmatter.id;
    seenIds.add(id);
    const text = buildEntryText(id, memory.frontmatter.tags, memory.body);
    const hash = hashContent(text);
    const prior = byId.get(id);

    if (prior && prior.hash === hash) {
      nextEntries.push({ ...prior, file_path: filePath });
      unchanged++;
      continue;
    }

    const vector = Array.from(await embedder.encode(text));
    nextEntries.push({ id, file_path: filePath, hash, vector });
    if (prior) {
      updated++;
    } else {
      added++;
    }
  }

  const removed = existing.entries.filter((e) => !seenIds.has(e.id)).length;
  existing.entries = nextEntries;
  await saveIndex(paths, existing);

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
