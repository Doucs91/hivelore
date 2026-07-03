import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseMemory } from "./parser.js";
import type { Memory } from "./types.js";

export interface LoadedMemory {
  memory: Memory;
  filePath: string;
}

export async function listMarkdownFilesRecursive(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listMarkdownFilesRecursive(full)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

export async function loadMemory(filePath: string): Promise<LoadedMemory> {
  const raw = await readFile(filePath, "utf8");
  return { memory: parseMemory(raw), filePath };
}

export async function loadMemoriesFromDir(dir: string): Promise<LoadedMemory[]> {
  return (await loadMemoriesFromDirDetailed(dir)).loaded;
}

export interface InvalidMemoryFile {
  filePath: string;
  error: string;
}

/**
 * Like loadMemoriesFromDir, but also reports files that failed to parse instead of
 * dropping them silently — a corrupt frontmatter otherwise makes a team lesson
 * vanish without any signal. Surfaced by `hivelore doctor`.
 */
export async function loadMemoriesFromDirDetailed(
  dir: string,
): Promise<{ loaded: LoadedMemory[]; invalid: InvalidMemoryFile[] }> {
  const files = await listMarkdownFilesRecursive(dir);
  const loaded: LoadedMemory[] = [];
  const invalid: InvalidMemoryFile[] = [];
  for (const file of files) {
    try {
      loaded.push(await loadMemory(file));
    } catch (err) {
      invalid.push({ filePath: file, error: err instanceof Error ? err.message.split("\n")[0]! : String(err) });
    }
  }
  return { loaded, invalid };
}
