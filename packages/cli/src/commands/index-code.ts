import path from "node:path";
import { Command } from "commander";
import {
  buildCodeMap,
  codeMapPath,
  findProjectRoot,
  resolveHaivePaths,
  saveCodeMap,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface IndexCodeOptions {
  dir?: string;
  exclude?: string;
}

export function registerIndexCode(program: Command): void {
  const idx = program.command("index").description("Build local indexes that help AIs read less code");
  idx.action(() => idx.help());
  idx
    .command("code")
    .description("Scan source files and write .ai/code-map.json (file → exports + 1-line description)")
    .option("-d, --dir <dir>", "project root")
    .option(
      "--exclude <csv>",
      "extra directory names to skip (comma-separated)",
      "",
    )
    .action(async (opts: IndexCodeOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const extraExcludes = (opts.exclude ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      ui.info(`Indexing source files in ${root}…`);
      const map = await buildCodeMap(root, {
        excludeDirs: [
          "node_modules",
          "dist",
          "build",
          "out",
          ".git",
          ".next",
          ".turbo",
          ".vitest-cache",
          "coverage",
          ...extraExcludes,
        ],
      });

      await saveCodeMap(paths, map);
      const fileCount = Object.keys(map.files).length;
      const exportCount = Object.values(map.files).reduce((s, f) => s + f.exports.length, 0);
      ui.success(
        `Indexed ${fileCount} file(s) with ${exportCount} export(s) → ${path.relative(root, codeMapPath(paths))}`,
      );
    });
}
