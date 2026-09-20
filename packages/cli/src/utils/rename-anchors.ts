import path from "node:path";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { loadMemoriesFromDir, serializeMemory, type HaivePaths } from "@hivelore/core";
import { gitText } from "./task-session.js";

/** Exact Git renames only. Similar basenames are suggestions, never sufficient proof. */
export function exactRenames(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  const parts = raw.split("\0");
  for (let i = 0; i < parts.length; i++) {
    const status = parts[i]!.trim();
    if (/^[RC]\d+$/.test(status)) {
      const from = parts[++i]; const to = parts[++i];
      if (status === "R100" && from && to && from !== to) result.set(from, to);
    } else if (/^[AMDTUXB]$/.test(status)) i++;
  }
  return result;
}

export async function repairRenamedAnchors(paths: HaivePaths, dryRun = false): Promise<string[]> {
  // A pending staged rename takes precedence over history. Restrict history to a bounded window.
  const history = await gitText(paths.root, ["log", "-20", "--reverse", "--format=", "--name-status", "-z", "--find-renames=100%"]).catch(() => "");
  const staged = await gitText(paths.root, ["diff", "--cached", "--name-status", "-z", "--find-renames=100%"]).catch(() => "");
  const renames = exactRenames(history + "\0" + staged);
  if (!renames.size) return [];
  const remap = (original: string): string => {
    if (existsSync(path.resolve(paths.root, original))) return original;
    let current = original;
    const seen = new Set<string>();
    while (renames.has(current) && !seen.has(current)) {
      seen.add(current); current = renames.get(current)!;
    }
    const relative = path.relative(paths.root, path.resolve(paths.root, current));
    return !relative.startsWith("..") && !path.isAbsolute(relative) && existsSync(path.resolve(paths.root, current)) ? current : original;
  };
  const repaired: string[] = [];
  for (const { memory, filePath } of await loadMemoriesFromDir(paths.memoriesDir)) {
    const rel = path.relative(paths.root, filePath);
    // Leave user-authored pending edits and partially staged memories for explicit review.
    const dirty = await gitText(paths.root, ["status", "--porcelain", "--", `:(literal)${rel}`]);
    if (dirty.trim()) continue;
    const fm = memory.frontmatter;
    const updated = { ...fm, anchor: { ...fm.anchor, paths: fm.anchor.paths.map(remap) },
      ...(fm.checks ? { checks: fm.checks.map(c => ({ ...c, path: remap(c.path) })) } : {}),
      ...(fm.sensor?.paths ? { sensor: { ...fm.sensor, paths: fm.sensor.paths.map(remap) } } : {}) };
    if (JSON.stringify(updated) === JSON.stringify(fm)) continue;
    if (!dryRun) await writeFile(filePath, serializeMemory({ frontmatter: updated, body: memory.body }));
    repaired.push(fm.id);
  }
  return repaired;
}
