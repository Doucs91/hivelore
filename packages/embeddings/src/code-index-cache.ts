import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HaivePaths } from "@hivelore/core";
import { DEFAULT_DIMENSION, DEFAULT_MODEL } from "./embedder.js";
import { cacheDir } from "./index-cache.js";

export const CODE_INDEX_FILE = "code-embeddings-index.json";

export interface CodeEmbeddingEntry {
  /** stable id: `${file}#${name}` */
  id: string;
  file: string;
  name: string;
  kind: string;
  line: number;
  description?: string;
  hash: string;
  vector: number[];
}

export interface CodeEmbeddingIndex {
  model: string;
  dimension: number;
  updated_at: string;
  source_generated_at: string;
  entries: CodeEmbeddingEntry[];
}

export function codeIndexPath(paths: HaivePaths): string {
  return path.join(cacheDir(paths), CODE_INDEX_FILE);
}

/**
 * Is the code-search embeddings index stale relative to the current code-map?
 * The indexer stamps `source_generated_at` with the code-map's `generated_at` it was built from,
 * so a mismatch means the code-map was rebuilt afterwards and the index may miss or mislocate symbols.
 * Unknown timestamps (empty strings) are treated as not-stale to avoid false alarms.
 */
export function isCodeIndexStale(indexSourceGeneratedAt: string, codeMapGeneratedAt: string): boolean {
  if (!indexSourceGeneratedAt || !codeMapGeneratedAt) return false;
  return indexSourceGeneratedAt !== codeMapGeneratedAt;
}

export function emptyCodeIndex(
  model = DEFAULT_MODEL,
  dimension = DEFAULT_DIMENSION,
  sourceGeneratedAt = "",
): CodeEmbeddingIndex {
  return {
    model,
    dimension,
    updated_at: new Date().toISOString(),
    source_generated_at: sourceGeneratedAt,
    entries: [],
  };
}

export async function loadCodeIndex(paths: HaivePaths): Promise<CodeEmbeddingIndex | null> {
  const file = codeIndexPath(paths);
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf8")) as CodeEmbeddingIndex;
}

export async function saveCodeIndex(paths: HaivePaths, index: CodeEmbeddingIndex): Promise<void> {
  const dir = cacheDir(paths);
  await mkdir(dir, { recursive: true });
  index.updated_at = new Date().toISOString();
  await writeFile(codeIndexPath(paths), JSON.stringify(index, null, 2), "utf8");
}

export function buildCodeEntryText(file: string, name: string, kind: string, description?: string): string {
  // The embedded text is what we search against — keep it tight and signal-dense.
  // Filename tokens often carry intent (e.g. "auth.controller.ts" → "auth controller").
  const filenameHints = file
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "")
    .replace(/[._-]+/g, " ") ?? "";
  return `${name} ${kind} ${filenameHints} ${description ?? ""}`.trim();
}
