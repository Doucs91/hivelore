import path from "node:path";
import type { LoadedMemory } from "./loader.js";

const MODULE_PATTERNS = [
  /^packages\/([^/]+)\//,
  /^apps\/([^/]+)\//,
  /^modules\/([^/]+)\//,
  /^src\/([^/]+)\//,
];

/**
 * Best-effort inference: given a list of file paths, infer module names from
 * conventional layouts (packages/X/, apps/X/, modules/X/, src/X/).
 */
export function inferModulesFromPaths(filePaths: string[]): string[] {
  const out = new Set<string>();
  for (const p of filePaths) {
    const norm = normalize(p);
    for (const re of MODULE_PATTERNS) {
      const m = norm.match(re);
      if (m && m[1]) out.add(m[1]);
    }
  }
  return [...out].sort();
}

/**
 * Path overlap: returns true if `a` and `b` refer to the same path or one is a
 * parent of the other. Both inputs are treated as POSIX-style relative paths.
 */
export function pathsOverlap(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  return na.startsWith(nb + "/") || nb.startsWith(na + "/");
}

export function memoryMatchesAnchorPaths(
  memory: LoadedMemory["memory"],
  inputPaths: string[],
): boolean {
  const anchorPaths = memory.frontmatter.anchor.paths;
  if (anchorPaths.length === 0) return false;
  for (const ap of anchorPaths) {
    for (const ip of inputPaths) {
      if (pathsOverlap(ap, ip)) return true;
    }
  }
  return false;
}

function normalize(p: string): string {
  // Strip leading "./" and trailing "/", normalize separators.
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function relPathFrom(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, "/");
}
