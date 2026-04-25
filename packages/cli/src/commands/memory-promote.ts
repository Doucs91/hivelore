import { mkdir, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  memoryFilePath,
  resolveHaivePaths,
  serializeMemory,
} from "@haive/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface PromoteOptions {
  dir?: string;
}

export function registerMemoryPromote(memory: Command): void {
  memory
    .command("promote <id>")
    .description("Promote a personal memory to team scope (status -> proposed)")
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: PromoteOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No memories directory at ${paths.memoriesDir}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.personalDir);
      const found = all.find((m) => m.memory.frontmatter.id === id);
      if (!found) {
        ui.error(`No personal memory with id "${id}". (Promotion only applies to personal scope.)`);
        process.exitCode = 1;
        return;
      }

      const updated = {
        frontmatter: {
          ...found.memory.frontmatter,
          scope: "team" as const,
          status: "proposed" as const,
        },
        body: found.memory.body,
      };

      const newPath = memoryFilePath(paths, "team", updated.frontmatter.id);
      await mkdir(path.dirname(newPath), { recursive: true });
      await writeFile(newPath, serializeMemory(updated), "utf8");
      await unlink(found.filePath);

      ui.success(`Promoted ${id} to team scope (status=proposed)`);
      ui.info(`Now at ${path.relative(root, newPath)}`);
    });
}
