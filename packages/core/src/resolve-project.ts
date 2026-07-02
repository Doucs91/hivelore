import { existsSync } from "node:fs";
import path from "node:path";
import { findProjectRoot, resolveHaivePaths } from "./paths.js";

const ROOT_MARKERS = [".ai", ".git", "package.json"] as const;

export interface ResolveProjectInfo {
  cwd: string;
  resolved_root: string;
  haive_project_root_env: string | null;
  explicit_root: boolean;
  haive_dir_exists: boolean;
  memories_dir_exists: boolean;
  runtime_dir: string;
  /** Which of `.ai`, `.git`, `package.json` exist at `resolved_root`. */
  markers_found: string[];
}

function markersAtRoot(root: string): string[] {
  const found: string[] = [];
  for (const m of ROOT_MARKERS) {
    if (existsSync(path.join(root, m))) found.push(m);
  }
  return found;
}

/**
 * Resolve the Hivelore project root for diagnostics (MCP / CLI). Never throws.
 */
export function resolveProjectInfo(opts: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): ResolveProjectInfo {
  const env = opts.env ?? process.env;
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const raw = env.HAIVE_PROJECT_ROOT;
  const explicit =
    raw !== undefined && raw !== "" ? path.resolve(raw) : null;
  const resolvedRoot = explicit ?? findProjectRoot(cwd);
  const paths = resolveHaivePaths(resolvedRoot);
  return {
    cwd,
    resolved_root: resolvedRoot,
    haive_project_root_env: explicit,
    explicit_root: explicit != null,
    haive_dir_exists: existsSync(paths.haiveDir),
    memories_dir_exists: existsSync(paths.memoriesDir),
    runtime_dir: paths.runtimeDir,
    markers_found: markersAtRoot(resolvedRoot),
  };
}
