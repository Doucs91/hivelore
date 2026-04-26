import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Memory } from "./types.js";

export interface VerifyResult {
  stale: boolean;
  reason: string | null;
  checkedPaths: string[];
  checkedSymbols: string[];
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
    return { stale: false, reason: null, checkedPaths, checkedSymbols };
  }

  const missingPaths: string[] = [];
  const existingAbsPaths: string[] = [];
  for (const rel of checkedPaths) {
    const abs = path.isAbsolute(rel) ? rel : path.join(options.projectRoot, rel);
    if (existsSync(abs)) {
      existingAbsPaths.push(abs);
    } else {
      missingPaths.push(rel);
    }
  }

  if (missingPaths.length > 0) {
    return {
      stale: true,
      reason: `anchor path(s) no longer exist: ${missingPaths.join(", ")}`,
      checkedPaths,
      checkedSymbols,
    };
  }

  if (checkedSymbols.length > 0) {
    if (existingAbsPaths.length === 0) {
      return {
        stale: true,
        reason: `cannot verify symbols (${checkedSymbols.join(", ")}): no anchor paths recorded`,
        checkedPaths,
        checkedSymbols,
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
      };
    }
  }

  return { stale: false, reason: null, checkedPaths, checkedSymbols };
}
