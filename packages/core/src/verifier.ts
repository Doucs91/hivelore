import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { globToRegExp, isGlobPath } from "./relevance.js";
import type { Memory } from "./types.js";

export interface VerifyResult {
  stale: boolean;
  reason: string | null;
  checkedPaths: string[];
  checkedSymbols: string[];
  possibleRenames: string[];
}

export interface VerifyOptions {
  /** Project root used to resolve relative anchor paths. */
  projectRoot: string;
}

/**
 * Verify that a memory's anchor still matches the current code.
 * - Every anchor.paths entry must exist on disk
 * - Every anchor.symbols entry must appear at least once across the anchor.paths
 *   files (or any tracked file if no paths are recorded)
 *
 * Anchorless memories (no paths and no symbols) are always considered fresh —
 * staleness only applies to memories that opted into anchoring.
 */
export async function verifyAnchor(
  memory: Memory,
  options: VerifyOptions,
): Promise<VerifyResult> {
  const anchor = memory.frontmatter.anchor;
  const checkedPaths = anchor.paths;
  const checkedSymbols = anchor.symbols;

  if (checkedPaths.length === 0 && checkedSymbols.length === 0) {
    return { stale: false, reason: null, checkedPaths, checkedSymbols, possibleRenames: [] };
  }

  const missingPaths: string[] = [];
  const existingAbsPaths: string[] = [];
  for (const rel of checkedPaths) {
    if (isGlobPath(rel)) {
      const matches = await findGlobMatches(rel, options.projectRoot);
      if (matches.length > 0) {
        existingAbsPaths.push(...matches.map((m) => path.join(options.projectRoot, m)));
      } else {
        missingPaths.push(rel);
      }
      continue;
    }
    const abs = path.isAbsolute(rel) ? rel : path.join(options.projectRoot, rel);
    if (existsSync(abs)) {
      existingAbsPaths.push(...await readableFilesForAnchor(abs));
    } else {
      missingPaths.push(rel);
    }
  }

  if (missingPaths.length > 0) {
    const possibleRenames = await findPossibleRenames(missingPaths, options.projectRoot);
    return {
      stale: true,
      reason: `anchor path(s) no longer exist: ${missingPaths.join(", ")}`,
      checkedPaths,
      checkedSymbols,
      possibleRenames,
    };
  }

  if (checkedSymbols.length > 0) {
    if (existingAbsPaths.length === 0) {
      return {
        stale: true,
        reason: `cannot verify symbols (${checkedSymbols.join(", ")}): no anchor paths recorded`,
        checkedPaths,
        checkedSymbols,
        possibleRenames: [],
      };
    }
    const missingSymbols: string[] = [];
    for (const sym of checkedSymbols) {
      let found = false;
      for (const file of existingAbsPaths) {
        try {
          const contents = await readFile(file, "utf8");
          if (contents.includes(sym)) {
            found = true;
            break;
          }
        } catch {
          // unreadable file; treat as not finding the symbol here
        }
      }
      if (!found) missingSymbols.push(sym);
    }
    if (missingSymbols.length > 0) {
      return {
        stale: true,
        reason: `anchor symbol(s) not found in any anchor path: ${missingSymbols.join(", ")}`,
        checkedPaths,
        checkedSymbols,
        possibleRenames: [],
      };
    }
  }

  return { stale: false, reason: null, checkedPaths, checkedSymbols, possibleRenames: [] };
}

async function findPossibleRenames(
  missingPaths: string[],
  projectRoot: string,
): Promise<string[]> {
  const basenames = new Set(missingPaths.map((p) => path.basename(p)));
  const found: string[] = [];
  try {
    await walkDir(projectRoot, projectRoot, basenames, found, 0);
  } catch {
    // best-effort
  }
  return found;
}

async function findGlobMatches(pattern: string, projectRoot: string): Promise<string[]> {
  const re = globToRegExp(pattern);
  const found: string[] = [];
  try {
    await walkAllFiles(projectRoot, projectRoot, found, 0, re);
  } catch {
    // best-effort
  }
  return found;
}

async function readableFilesForAnchor(abs: string): Promise<string[]> {
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      const out: string[] = [];
      await walkReadableFiles(abs, out, 0);
      return out;
    }
    if (s.isFile()) return [abs];
  } catch {
    return [abs];
  }
  return [abs];
}

async function walkReadableFiles(dir: string, found: string[], depth: number): Promise<void> {
  if (depth > 6) return;
  let entries: string[];
  try {
    entries = await readdir(dir, { encoding: "utf8" });
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const abs = path.join(dir, name);
    try {
      const s = await stat(abs);
      if (s.isDirectory()) await walkReadableFiles(abs, found, depth + 1);
      else if (s.isFile()) found.push(abs);
    } catch {
      continue;
    }
  }
}

async function walkAllFiles(
  dir: string,
  root: string,
  found: string[],
  depth: number,
  match: RegExp,
): Promise<void> {
  if (depth > 12) return;
  let entries: string[];
  try {
    entries = await readdir(dir, { encoding: "utf8" });
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === ".ai") continue;
    const abs = path.join(dir, name);
    try {
      const s = await stat(abs);
      if (s.isDirectory()) {
        await walkAllFiles(abs, root, found, depth + 1, match);
      } else if (s.isFile()) {
        const rel = path.relative(root, abs).replace(/\\/g, "/");
        if (match.test(rel)) found.push(rel);
      }
    } catch {
      continue;
    }
  }
}

async function walkDir(
  dir: string,
  root: string,
  targets: Set<string>,
  found: string[],
  depth: number,
): Promise<void> {
  if (depth > 6) return;
  let entries: string[];
  try {
    entries = await readdir(dir, { encoding: "utf8" });
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const abs = path.join(dir, name);
    let isDir = false;
    try {
      isDir = (await stat(abs)).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      await walkDir(abs, root, targets, found, depth + 1);
    } else if (targets.has(name)) {
      found.push(path.relative(root, abs));
    }
  }
}
