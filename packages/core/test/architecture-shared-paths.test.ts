import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Architecture guard for the recurring "drift smell": prevention recording was twice bolted onto an
 * extra entry point instead of the one shared path, and silently diverged (regex sensors orphaned from
 * the gate; prevention not recorded in the gate — see the harness-positioning gotchas). The cure is a
 * single recorder, `recordPreventionHits`. This test FAILS the build if any source file calls the
 * low-level recorders (`appendPreventionEvent` / `recordPrevention`) directly instead of going through
 * it — so a new gate/tool/CLI path can never re-introduce the leak unnoticed.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGES_DIR = path.resolve(HERE, "..", "..");

// Only these files may reference the low-level recorders: usage.ts DEFINES recordPrevention;
// prevention.ts DEFINES appendPreventionEvent and IS the shared recorder (recordPreventionHits).
const ALLOWED = new Set([
  path.join("core", "src", "usage.ts"),
  path.join("core", "src", "prevention.ts"),
]);

const LOW_LEVEL_CALL = /\b(appendPreventionEvent|recordPrevention)\s*\(/;

function srcFiles(pkg: string): string[] {
  const dir = path.join(PACKAGES_DIR, pkg, "src");
  const out: string[] = [];
  const walk = (d: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(d);
    } catch {
      return;
    }
    for (const name of entries) {
      const full = path.join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
    }
  };
  walk(dir);
  return out;
}

describe("architecture: prevention recording funnels through the single shared recorder", () => {
  it("no source outside prevention.ts/usage.ts calls the low-level recorders directly", () => {
    const offenders: string[] = [];
    for (const pkg of ["core", "cli", "mcp"]) {
      for (const file of srcFiles(pkg)) {
        const rel = path.relative(PACKAGES_DIR, file);
        if (ALLOWED.has(rel)) continue;
        const text = readFileSync(file, "utf8");
        if (LOW_LEVEL_CALL.test(text)) {
          offenders.push(rel);
        }
      }
    }
    expect(
      offenders,
      `These files bypass the shared recorder (recordPreventionHits). Route prevention through it instead:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
