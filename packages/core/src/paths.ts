import { existsSync } from "node:fs";
import path from "node:path";

export const HAIVE_DIR = ".ai";

const ROOT_MARKERS = [".ai", ".git", "package.json"];

export function findProjectRoot(startDir: string = process.cwd()): string {
  let current = path.resolve(startDir);
  const fsRoot = path.parse(current).root;
  while (current !== fsRoot) {
    for (const marker of ROOT_MARKERS) {
      if (existsSync(path.join(current, marker))) return current;
    }
    current = path.dirname(current);
  }
  return path.resolve(startDir);
}

export const PROJECT_CONTEXT_FILE = "project-context.md";
export const MEMORIES_DIR = "memories";

export interface HaivePaths {
  root: string;
  haiveDir: string;
  projectContext: string;
  memoriesDir: string;
  personalDir: string;
  teamDir: string;
  moduleDir: string;
  modulesContextDir: string;
}

export function resolveHaivePaths(projectRoot: string): HaivePaths {
  const haiveDir = path.join(projectRoot, HAIVE_DIR);
  const memoriesDir = path.join(haiveDir, MEMORIES_DIR);
  return {
    root: projectRoot,
    haiveDir,
    projectContext: path.join(haiveDir, PROJECT_CONTEXT_FILE),
    memoriesDir,
    personalDir: path.join(memoriesDir, "personal"),
    teamDir: path.join(memoriesDir, "team"),
    moduleDir: path.join(memoriesDir, "module"),
    modulesContextDir: path.join(haiveDir, "modules"),
  };
}

export function memoryFilePath(
  paths: HaivePaths,
  scope: "personal" | "team" | "module",
  id: string,
  module?: string,
): string {
  const base =
    scope === "personal"
      ? paths.personalDir
      : scope === "team"
        ? paths.teamDir
        : path.join(paths.moduleDir, module ?? "_unscoped");
  return path.join(base, `${id}.md`);
}
