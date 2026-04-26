import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  parseMemory,
  resolveHaivePaths,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface EditOptions {
  editor?: string;
  dir?: string;
}

export function registerMemoryEdit(memory: Command): void {
  memory
    .command("edit <id>")
    .description("Open a memory in $EDITOR and re-validate when you save")
    .option("-e, --editor <cmd>", "editor command (defaults to $EDITOR or 'vi')")
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: EditOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const found = all.find((m) => m.memory.frontmatter.id === id);
      if (!found) {
        ui.error(`No memory with id "${id}".`);
        process.exitCode = 1;
        return;
      }

      const editor = opts.editor ?? process.env.EDITOR ?? process.env.VISUAL ?? "vi";
      ui.info(`Opening ${path.relative(root, found.filePath)} with ${editor}…`);
      const code = await runEditor(editor, found.filePath);
      if (code !== 0) {
        ui.warn(`Editor exited with status ${code}.`);
      }

      try {
        const fresh = await readFile(found.filePath, "utf8");
        parseMemory(fresh);
        ui.success("Memory still parses cleanly.");
      } catch (err) {
        ui.error(
          `Memory no longer parses: ${err instanceof Error ? err.message : String(err)}`,
        );
        ui.warn("File left as-is on disk; fix it and re-run a parse-aware command to confirm.");
        process.exitCode = 1;
      }
    });
}

function runEditor(editor: string, file: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(editor, [file], { stdio: "inherit" });
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", () => resolve(127));
  });
}
