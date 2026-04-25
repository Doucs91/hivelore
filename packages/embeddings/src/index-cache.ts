import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { HaivePaths } from "@haive/core";
import { DEFAULT_DIMENSION, DEFAULT_MODEL } from "./embedder.js";

export const INDEX_FILE = "embeddings-index.json";

export interface EmbeddingEntry {
  id: string;
  file_path: string;
  hash: string;
  vector: number[];
}

export interface EmbeddingIndex {
  model: string;
  dimension: number;
  updated_at: string;
  entries: EmbeddingEntry[];
}

export function cacheDir(paths: HaivePaths): string {
  return path.join(paths.haiveDir, ".cache", "embeddings");
}

export function indexPath(paths: HaivePaths): string {
  return path.join(cacheDir(paths), INDEX_FILE);
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function emptyIndex(model = DEFAULT_MODEL, dimension = DEFAULT_DIMENSION): EmbeddingIndex {
  return {
    model,
    dimension,
    updated_at: new Date().toISOString(),
    entries: [],
  };
}

export async function loadIndex(paths: HaivePaths): Promise<EmbeddingIndex | null> {
  const file = indexPath(paths);
  if (!existsSync(file)) return null;
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as EmbeddingIndex;
}

export async function saveIndex(paths: HaivePaths, index: EmbeddingIndex): Promise<void> {
  const dir = cacheDir(paths);
  await mkdir(dir, { recursive: true });
  index.updated_at = new Date().toISOString();
  await writeFile(indexPath(paths), JSON.stringify(index, null, 2), "utf8");
}

export async function indexStat(paths: HaivePaths): Promise<{
  exists: boolean;
  count: number;
  model: string | null;
  updatedAt: string | null;
  sizeBytes: number;
}> {
  const file = indexPath(paths);
  if (!existsSync(file)) {
    return { exists: false, count: 0, model: null, updatedAt: null, sizeBytes: 0 };
  }
  const idx = await loadIndex(paths);
  const st = await stat(file);
  return {
    exists: true,
    count: idx?.entries.length ?? 0,
    model: idx?.model ?? null,
    updatedAt: idx?.updated_at ?? null,
    sizeBytes: st.size,
  };
}

export function buildEntryText(id: string, tags: string[], body: string): string {
  // Concatenate id + tags + body so search works on metadata too.
  // Tags are weighted by repetition so they contribute more to the embedding.
  const tagPart = tags.length ? `${tags.join(" ")} ${tags.join(" ")} ` : "";
  return `${id} ${tagPart}${body}`;
}
