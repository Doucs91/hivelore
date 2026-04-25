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
  const files = await listMarkdownFilesRecursive(dir);
  const out: LoadedMemory[] = [];
  for (const file of files) {
    try {
      out.push(await loadMemory(file));
    } catch {
      // Skip unparseable files in v0.1; future: surface a warning channel.
    }
  }
  return out;
}
