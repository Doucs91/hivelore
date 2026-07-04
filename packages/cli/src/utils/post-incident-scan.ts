/**
 * Collector for the scaffold-loop check (behaviour bridge accounting): find written post-incident
 * scaffolds on disk and cross-check them against the corpus with core's pure `assessScaffoldLoop`.
 *
 * A scaffold lives in an `incidents/` directory (`tests/incidents/…` for vitest/jest/pytest,
 * `incidents/` for go — the shapes `scaffoldPostIncidentTest` generates), so the walk only reads
 * files inside directories named `incidents`, pruned of dependency/build trees. A custom
 * `--out` scaffold outside such a directory is out of scope — documented trade-off.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  assessScaffoldLoop,
  loadMemoriesFromDir,
  SCAFFOLD_MARKER_RE,
  type ScaffoldLoopGap,
  type resolveHaivePaths,
} from "@hivelore/core";

const PRUNED_DIRS = new Set([
  "node_modules", ".git", ".ai", "dist", "build", "out", "coverage", ".next", ".venv", "venv",
  "__pycache__", "target", "vendor",
]);
const MAX_SCAFFOLD_BYTES = 64 * 1024;
const MAX_DEPTH = 8;

/** Recursively collect files under directories named `incidents` that carry the scaffold marker. */
export function findPostIncidentScaffoldFiles(root: string): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const walk = (dir: string, depth: number, inIncidents: boolean): void => {
    if (depth > MAX_DEPTH) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (PRUNED_DIRS.has(entry)) continue;
      const abs = path.join(dir, entry);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(abs, depth + 1, inIncidents || entry === "incidents");
        continue;
      }
      if (!inIncidents || stat.size > MAX_SCAFFOLD_BYTES) continue;
      try {
        const content = readFileSync(abs, "utf8");
        if (SCAFFOLD_MARKER_RE.test(content)) {
          results.push({ path: path.relative(root, abs).split(path.sep).join("/"), content });
        }
      } catch {
        /* unreadable — skip */
      }
    }
  };
  walk(root, 0, false);
  return results;
}

/** Load the corpus and return the open scaffold loops (pending stubs / unarmed oracles). */
export async function collectScaffoldLoopGaps(
  paths: ReturnType<typeof resolveHaivePaths>,
): Promise<ScaffoldLoopGap[]> {
  const files = findPostIncidentScaffoldFiles(paths.root);
  if (files.length === 0) return [];
  const loaded = existsSync(paths.memoriesDir) ? await loadMemoriesFromDir(paths.memoriesDir) : [];
  const memories = loaded.map(({ memory }) => ({
    id: memory.frontmatter.id,
    sensorKind: memory.frontmatter.sensor?.kind ?? null,
  }));
  return assessScaffoldLoop(files, memories);
}

/** One-line description of a gap, used by both doctor and `enforce finish`. */
export function describeScaffoldGap(gap: ScaffoldLoopGap): string {
  const state = gap.memory_missing
    ? "lesson deleted"
    : gap.pending && !gap.armed
      ? "pending, not armed"
      : gap.pending
        ? "armed but still pending"
        : "not armed";
  return `${gap.path} (${state} — ${gap.memory_id})`;
}
