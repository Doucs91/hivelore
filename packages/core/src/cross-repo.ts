/**
 * Cross-repo memory import — pulls `shared`-scoped memories from other projects.
 *
 * Strategy:
 *   1. For each CrossRepoSource in haive.config.json, resolve the source root.
 *   2. Load memories from <source>/.ai/memories/ where scope=shared (+ optional filter).
 *   3. Track imports via .ai/.cache/cross-repo/<name>/import-map.json
 *      (sourceId → localFilePath).
 *   4. Write new/updated memories to .ai/memories/shared/<source-name>/.
 *   5. Return a report: { imported, updated, skipped, errors }.
 *
 * Imported memories are tagged with `cross-repo:<source-name>` so they are
 * identifiable and excluded from cross-repo-push to prevent echo loops.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  buildFrontmatter,
  loadMemoriesFromDir,
  resolveHaivePaths,
  serializeMemory,
} from "./index.js";
import type { CrossRepoSource, HaiveConfig } from "./config.js";
import type { HaivePaths } from "./paths.js";

export interface CrossRepoReport {
  source: string;
  imported: string[];
  updated: string[];
  skipped: string[];
  errors: string[];
}

type ImportMap = Record<string, string>; // sourceId → local absolute filePath

async function loadImportMap(cacheDir: string): Promise<ImportMap> {
  const mapPath = path.join(cacheDir, "import-map.json");
  if (!existsSync(mapPath)) return {};
  try {
    return JSON.parse(await readFile(mapPath, "utf8")) as ImportMap;
  } catch {
    return {};
  }
}

async function saveImportMap(cacheDir: string, map: ImportMap): Promise<void> {
  await writeFile(path.join(cacheDir, "import-map.json"), JSON.stringify(map, null, 2) + "\n", "utf8");
}

/**
 * Pull shared memories from all configured cross-repo sources.
 * Returns one report per source.
 */
export async function pullCrossRepoSources(
  paths: HaivePaths,
  config: HaiveConfig,
  projectRoot: string,
): Promise<CrossRepoReport[]> {
  const sources = config.crossRepoSources ?? [];
  if (sources.length === 0) return [];

  const reports: CrossRepoReport[] = [];
  for (const source of sources) {
    reports.push(await pullFromSource(paths, source, projectRoot));
  }
  return reports;
}

async function pullFromSource(
  paths: HaivePaths,
  source: CrossRepoSource,
  projectRoot: string,
): Promise<CrossRepoReport> {
  const report: CrossRepoReport = {
    source: source.name,
    imported: [],
    updated: [],
    skipped: [],
    errors: [],
  };

  // Resolve source root
  let sourceRoot: string | null = null;
  if (source.path) {
    const resolved = path.resolve(projectRoot, source.path);
    if (!existsSync(resolved)) {
      report.errors.push(`Path not found: ${resolved}`);
      return report;
    }
    sourceRoot = resolved;
  } else if (source.git) {
    sourceRoot = await cloneOrFetchGitSource(source, paths, report);
    if (!sourceRoot) return report;
  } else {
    report.errors.push(`Source "${source.name}" has neither path nor git — skipping.`);
    return report;
  }

  const sourcePaths = resolveHaivePaths(sourceRoot);
  if (!existsSync(sourcePaths.memoriesDir)) {
    report.errors.push(`No .ai/memories/ found at ${sourceRoot}`);
    return report;
  }

  // Load source memories filtered to scope=shared
  const sourceMemories = (await loadMemoriesFromDir(sourcePaths.memoriesDir)).filter(
    ({ memory }) => {
      const fm = memory.frontmatter;
      if (fm.scope !== "shared") return false;
      if (fm.status === "rejected" || fm.status === "deprecated") return false;
      if (source.filter?.tags && source.filter.tags.length > 0) {
        const hasTag = source.filter.tags.some((t) => fm.tags.includes(t));
        if (!hasTag) return false;
      }
      if (source.filter?.types && source.filter.types.length > 0) {
        if (!source.filter.types.includes(fm.type)) return false;
      }
      return true;
    },
  );

  if (sourceMemories.length === 0) {
    report.skipped.push("no shared memories found in source");
    return report;
  }

  // Destination: .ai/memories/shared/<source-name>/
  const destDir = path.join(paths.memoriesDir, "shared", source.name);
  await mkdir(destDir, { recursive: true });

  // Cache dir for import tracking
  const cacheDir = path.join(paths.haiveDir, ".cache", "cross-repo", source.name);
  await mkdir(cacheDir, { recursive: true });
  const importMap = await loadImportMap(cacheDir);
  const mapDirty = false;
  let dirty = mapDirty;

  for (const { memory } of sourceMemories) {
    const fm = memory.frontmatter;
    const sourceId = fm.id;
    const importTag = `cross-repo:${source.name}`;
    const tags = [...new Set([...fm.tags, importTag])];

    const importedBodyPrefix =
      `> **Imported from \`${source.name}\`** (original id: \`${sourceId}\`)  \n` +
      `> Imported at: ${new Date().toISOString()}\n\n`;

    const existingLocalPath = importMap[sourceId];

    if (existingLocalPath && existsSync(existingLocalPath)) {
      // Already imported — check if body changed in source
      const existingFiles = await loadMemoriesFromDir(destDir);
      const existingEntry = existingFiles.find(({ filePath }) => filePath === existingLocalPath);
      const sourceBodyStripped = memory.body.trim();
      const existingBodyStripped = (existingEntry?.memory.body ?? "")
        .replace(/^>.*\n>.*\n\n/m, "")
        .trim();

      if (existingBodyStripped === sourceBodyStripped) {
        report.skipped.push(sourceId);
        continue;
      }

      // Body changed — update
      const updatedBody = importedBodyPrefix + memory.body;
      if (existingEntry) {
        await writeFile(
          existingLocalPath,
          serializeMemory({ frontmatter: existingEntry.memory.frontmatter, body: updatedBody }),
          "utf8",
        );
      }
      report.updated.push(sourceId);
    } else {
      // New import
      const slug = `${source.name}-${fm.id.slice(0, 40)}`;
      const newFm = buildFrontmatter({
        type: fm.type,
        slug,
        scope: "team" as const,
        module: undefined,
        status: "validated",
        tags,
        domain: fm.domain,
        author: fm.author,
        paths: fm.anchor.paths,
        symbols: fm.anchor.symbols,
        commit: fm.anchor.commit,
        topic: fm.topic ? `${source.name}:${fm.topic}` : undefined,
      });

      const body = importedBodyPrefix + memory.body;
      const destPath = path.join(destDir, `${newFm.id}.md`);
      await writeFile(destPath, serializeMemory({ frontmatter: newFm, body }), "utf8");
      importMap[sourceId] = destPath;
      dirty = true;
      report.imported.push(sourceId);
    }
  }

  if (dirty) await saveImportMap(cacheDir, importMap);
  return report;
}

/**
 * Clone or fetch a git source into .ai/.cache/cross-repo/<name>/.
 * Returns the resolved local path, or null on error.
 */
async function cloneOrFetchGitSource(
  source: CrossRepoSource,
  paths: HaivePaths,
  report: CrossRepoReport,
): Promise<string | null> {
  const cacheDir = path.join(paths.haiveDir, ".cache", "cross-repo", source.name);
  await mkdir(cacheDir, { recursive: true });

  if (existsSync(path.join(cacheDir, ".git"))) {
    const result = spawnSync("git", ["fetch", "--depth=1", "origin"], {
      cwd: cacheDir,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      report.errors.push(`git fetch failed for ${source.name}: ${result.stderr}`);
      return null;
    }
    spawnSync("git", ["reset", "--hard", "FETCH_HEAD"], { cwd: cacheDir });
  } else {
    const result = spawnSync(
      "git",
      ["clone", "--depth=1", source.git!, "."],
      { cwd: cacheDir, encoding: "utf8" },
    );
    if (result.status !== 0) {
      report.errors.push(`git clone failed for ${source.name}: ${result.stderr}`);
      return null;
    }
  }

  return cacheDir;
}
