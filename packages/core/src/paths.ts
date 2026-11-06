import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const HAIVE_DIR = ".ai";


/**
 * A `.ai/` Hivelore initialised — not a stray `.ai/.cache` or `.ai/.runtime` some tool created in a
 * subfolder. A stray one used to stop the upward search, so `enforce check` run from `frontend/`
 * answered "not initialized" in an initialised repo (field review 2026-09-30 §3.7).
 */
function isInitializedAiDir(aiDir: string): boolean {
  return ["memories", "hivelore.config.json", "haive.config.json", PROJECT_CONTEXT_FILE].some((name) => existsSync(path.join(aiDir, name)));
}

export function findProjectRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  let fallback: string | undefined;
  let strayAi: string | undefined;
  while (true) {
    const aiDir = path.join(current, ".ai");
    if (existsSync(aiDir)) {
      if (isInitializedAiDir(aiDir)) return current;
      strayAi ??= current;
    }
    if (existsSync(path.join(current, ".git"))) return current;
    if (!fallback && existsSync(path.join(current, "package.json"))) fallback = current;
    const parent = path.dirname(current);
    if (parent === current) return strayAi ?? fallback ?? path.resolve(startDir);
    current = parent;
  }
}

export const PROJECT_CONTEXT_FILE = "project-context.md";
export const MEMORIES_DIR = "memories";

export interface HaivePaths {
  root: string;
  haiveDir: string;
  /** Disposable local layer (session journal, caches). Not team truth — see `.ai/.runtime/` layout. */
  runtimeDir: string;
  /**
   * Machine-local caches (embedding indexes, code map, observation journal, telemetry). Lives
   * OUTSIDE the repo by default — `~/.cache/hivelore/<repo>-<hash>/` — see {@link resolveCacheDir}.
   */
  cacheDir: string;
  projectContext: string;
  memoriesDir: string;
  personalDir: string;
  teamDir: string;
  sharedDir: string;
  moduleDir: string;
  modulesContextDir: string;
}

export function resolveHaivePaths(projectRoot: string): HaivePaths {
  const haiveDir = path.join(projectRoot, HAIVE_DIR);
  const memoriesDir = path.join(haiveDir, MEMORIES_DIR);
  return {
    root: projectRoot,
    haiveDir,
    runtimeDir: path.join(haiveDir, ".runtime"),
    cacheDir: resolveCacheDir(projectRoot),
    projectContext: path.join(haiveDir, PROJECT_CONTEXT_FILE),
    memoriesDir,
    personalDir: path.join(memoriesDir, "personal"),
    teamDir: path.join(memoriesDir, "team"),
    sharedDir: path.join(memoriesDir, "shared"),
    moduleDir: path.join(memoriesDir, "module"),
    modulesContextDir: path.join(haiveDir, "modules"),
  };
}

export function memoryFilePath(
  paths: HaivePaths,
  scope: "personal" | "team" | "module" | "shared",
  id: string,
  module?: string,
): string {
  const base =
    scope === "personal"
      ? paths.personalDir
      : scope === "team"
        ? paths.teamDir
        : scope === "shared"
          ? paths.sharedDir
          : path.join(paths.moduleDir, module ?? "_unscoped");
  return path.join(base, `${id}.md`);
}

/**
 * Personal memories are private by definition and must never be one `git add -A` away from a
 * commit. They used to sit unignored in the working tree: one was committed by mistake and had to be
 * purged from history, another stayed in `git status` forever (field report #8 §2). A `.gitignore`
 * INSIDE the directory protects the repo even when the root `.gitignore` is not ours to edit, and
 * every personal write calls this so repositories initialised by older versions are covered too.
 */
export async function ensurePersonalMemoriesIgnored(paths: HaivePaths): Promise<void> {
  try {
    await mkdir(paths.personalDir, { recursive: true });
    const gi = path.join(paths.personalDir, ".gitignore");
    if (!existsSync(gi)) {
      await writeFile(gi, "# Personal Hivelore memories are machine-local and never committed.\n*\n!.gitignore\n", "utf8");
    }
  } catch {
    /* best-effort: a read-only checkout must not fail a save */
  }
}

/** The pre-0.67 in-repo cache location, kept for migration and as the explicit opt-out. */
export function legacyCacheDir(projectRoot: string): string {
  return path.join(projectRoot, HAIVE_DIR, ".cache");
}

/** `cacheDir` from `.ai/hivelore.config.json` (or the legacy file), read synchronously. */
function configuredCacheDir(projectRoot: string): string | undefined {
  for (const name of ["hivelore.config.json", "haive.config.json"]) {
    try {
      const value = (JSON.parse(readFileSync(path.join(projectRoot, HAIVE_DIR, name), "utf8")) as { cacheDir?: unknown }).cacheDir;
      return typeof value === "string" && value.trim() ? value.trim() : undefined;
    } catch {
      /* missing or unreadable — try the next name */
    }
  }
  return undefined;
}

/** Stable per-checkout key: readable basename + hash of the real path. */
export function repoCacheKey(projectRoot: string): string {
  let real = path.resolve(projectRoot);
  try { real = realpathSync(real); } catch { /* not created yet */ }
  const base = path.basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "repo";
  return `${base}-${createHash("sha256").update(real).digest("hex").slice(0, 12)}`;
}

/**
 * Where machine-local caches live. A 460 KB corpus came with a 181 MB `.ai/.cache` INSIDE the repo
 * (field report #11 §8): it bloated backups, Docker build contexts and IDE indexing, and every tool
 * that walks the tree had to know to skip it. Caches now default to the user cache directory:
 *
 *   $HIVELORE_CACHE_DIR, else `cacheDir` in .ai/hivelore.config.json:
 *                                  absolute → `<it>/<repo-key>`; relative (e.g. `.ai/.cache`) →
 *                                  resolved against the project root and used as is (the opt-out);
 *   $XDG_CACHE_HOME/hivelore/<key> or ~/.cache/hivelore/<key> (Linux/macOS),
 *   %LOCALAPPDATA%\hivelore\Cache\<key> (Windows).
 *
 * The key is per checkout (real path), so two worktrees never share a code index built from
 * different branches. Without a home directory it falls back to the legacy in-repo location.
 */
export function resolveCacheDir(projectRoot: string, env: NodeJS.ProcessEnv = process.env): string {
  // The env var wins; the repo config is the durable form — MCP clients start servers with a reduced
  // environment, and the CLI and the server must agree on one cache.
  const override = env["HIVELORE_CACHE_DIR"]?.trim() || configuredCacheDir(projectRoot);
  if (override) {
    return path.isAbsolute(override) ? path.join(override, repoCacheKey(projectRoot)) : path.resolve(projectRoot, override);
  }
  let home = "";
  try { home = os.homedir(); } catch { /* no home */ }
  let base: string | undefined;
  if (process.platform === "win32") {
    const local = env["LOCALAPPDATA"]?.trim() || (home ? path.join(home, "AppData", "Local") : "");
    if (local) base = path.join(local, "hivelore", "Cache");
  } else {
    const xdg = env["XDG_CACHE_HOME"]?.trim();
    if (xdg && path.isAbsolute(xdg)) base = path.join(xdg, "hivelore");
    else if (home) base = path.join(home, ".cache", "hivelore");
  }
  return base ? path.join(base, repoCacheKey(projectRoot)) : legacyCacheDir(projectRoot);
}

export interface CacheMigrationResult {
  migrated: boolean;
  /** "renamed" moved everything; "copied-state" kept small state files and left the rest behind. */
  how?: "renamed" | "copied-state";
  from?: string;
  to?: string;
}

/**
 * One-time move of a pre-0.67 `.ai/.cache` to the user cache directory. Synchronous and cheap when
 * there is nothing to do (two `existsSync`). A same-filesystem rename moves everything atomically;
 * across filesystems only small state files (usage, prevention log, eval history…) are copied —
 * indexes rebuild on demand — and the legacy directory is left for `hivelore doctor --fix` to remove.
 * Never throws: a cache that cannot move is still a working cache.
 */
export function migrateLegacyCache(paths: HaivePaths): CacheMigrationResult {
  const legacy = legacyCacheDir(paths.root);
  if (path.resolve(paths.cacheDir) === path.resolve(legacy)) return { migrated: false };
  try {
    if (!existsSync(legacy) || existsSync(paths.cacheDir)) return { migrated: false };
    const entries = readdirSync(legacy).filter((name) => name !== ".gitignore");
    if (entries.length === 0) return { migrated: false };
    mkdirSync(path.dirname(paths.cacheDir), { recursive: true });
    try {
      renameSync(legacy, paths.cacheDir);
      rmSync(path.join(paths.cacheDir, ".gitignore"), { force: true });
      return { migrated: true, how: "renamed", from: legacy, to: paths.cacheDir };
    } catch {
      mkdirSync(paths.cacheDir, { recursive: true });
      for (const name of entries) {
        const src = path.join(legacy, name);
        try {
          const st = statSync(src);
          if (st.isFile() && st.size <= 8 * 1024 * 1024 && /\.(?:json|jsonl)$/.test(name)) {
            copyFileSync(src, path.join(paths.cacheDir, name));
          }
        } catch { /* skip */ }
      }
      return { migrated: true, how: "copied-state", from: legacy, to: paths.cacheDir };
    }
  } catch {
    return { migrated: false };
  }
}
