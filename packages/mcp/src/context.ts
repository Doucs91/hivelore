import { findProjectRoot, resolveHaivePaths, type HaivePaths } from "@hiveai/core";

export interface HaiveContext {
  paths: HaivePaths;
}

export interface CreateContextOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export function createContext(options: CreateContextOptions = {}): HaiveContext {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const root =
    options.root ??
    env.HAIVE_PROJECT_ROOT ??
    findProjectRoot(cwd);
  return { paths: resolveHaivePaths(root) };
}
