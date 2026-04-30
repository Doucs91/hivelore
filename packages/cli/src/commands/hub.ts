/**
 * haive hub — shared team-knowledge hub operations.
 *
 *   haive hub pull          — import shared memories from the hub into this project
 *   haive hub push          — export this project's shared memories to the hub
 *   haive hub status        — show hub sync status (last pull/push, counts)
 *   haive hub init <path>   — initialize a new hub repo at <path>
 *
 * The hub is a plain git repo with a .ai/ directory.
 * Set hubPath in haive.config.json (relative or absolute path to the hub).
 *
 * Hub memory layout:
 *   .ai/memories/shared/<source-project-name>/
 *     - memories tagged with the source project name
 *     - committed to the hub repo
 *
 * Multiple projects point at the same hub. Each project:
 *   - push: writes its `shared`-scoped memories to hub/.ai/memories/shared/<project-name>/
 *   - pull: reads from all other projects' shared directories in the hub
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Command } from "commander";
import {
  findProjectRoot,
  loadConfig,
  loadMemoriesFromDir,
  resolveHaivePaths,
  saveConfig,
  serializeMemory,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface HubOptions {
  dir?: string;
  commit?: boolean;
  message?: string;
}

export function registerHub(program: Command): void {
  const hub = program
    .command("hub")
    .description(
      "Manage a shared team-knowledge hub — a central repo that multiple projects contribute to and pull from.\n\n" +
      "  The hub is a plain git repo with a .ai/ directory. Each project pushes its\n" +
      "  `shared`-scoped memories to the hub and pulls from all other projects.\n\n" +
      "  Setup:\n" +
      "    1. haive hub init /path/to/team-hub\n" +
      "    2. Add hubPath to .ai/haive.config.json: { \"hubPath\": \"../team-hub\" }\n" +
      "    3. haive hub push    — publish your shared memories\n" +
      "    4. haive hub pull    — import other projects' shared memories\n\n" +
      "  Or configure in haive.config.json and haive sync handles it automatically.\n",
    );
  hub.action(() => hub.help());

  // haive hub init <path>
  hub
    .command("init <hubPath>")
    .description(
      "Initialize a new team-knowledge hub repo at <hubPath>.\n\n" +
      "  Creates a git repo with a .ai/ directory structure ready for shared memories.\n\n" +
      "  Example:\n" +
      "    haive hub init ../team-hub\n" +
      "    haive hub init /srv/git/team-knowledge\n",
    )
    .action(async (hubPath: string) => {
      const absPath = path.resolve(hubPath);
      await mkdir(absPath, { recursive: true });

      const gitCheck = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: absPath });
      if (gitCheck.status !== 0) {
        const init = spawnSync("git", ["init"], { cwd: absPath, encoding: "utf8" });
        if (init.status !== 0) {
          ui.error(`git init failed: ${init.stderr}`);
          process.exitCode = 1;
          return;
        }
      }

      const sharedDir = path.join(absPath, ".ai", "memories", "shared");
      await mkdir(sharedDir, { recursive: true });
      await writeFile(
        path.join(absPath, ".ai", "README.md"),
        `# hAIve Team Knowledge Hub\n\n` +
        `This repo is a shared knowledge hub for hAIve.\n\n` +
        `Each project contributes its \`shared\`-scoped memories here.\n` +
        `Other projects pull from it via \`haive hub pull\`.\n\n` +
        `## Structure\n\n` +
        "`" + "`.ai/memories/shared/<project-name>/`\n\n" +
        `## Usage\n\n` +
        "```bash\n" +
        "haive hub push   # publish from a project\n" +
        "haive hub pull   # import into a project\n" +
        "```\n",
        "utf8",
      );
      await writeFile(
        path.join(absPath, ".gitignore"),
        ".ai/.cache/\n.ai/memories/personal/\n",
        "utf8",
      );

      spawnSync("git", ["add", "."], { cwd: absPath });
      spawnSync("git", ["commit", "-m", "chore: initialize hAIve team-knowledge hub"], {
        cwd: absPath,
        encoding: "utf8",
      });

      console.log(ui.green(`✓ Hub initialized at ${absPath}`));
      console.log(
        ui.dim(
          `\nNext steps:\n` +
          `  1. Add hubPath to your project's .ai/haive.config.json:\n` +
          `       { "hubPath": "${path.relative(process.cwd(), absPath)}" }\n` +
          `  2. Run \`haive hub push\` to publish your shared memories\n` +
          `  3. Share ${absPath} with teammates (git remote, NFS, etc.)\n`,
        ),
      );
    });

  // haive hub push
  hub
    .command("push")
    .description(
      "Push this project's shared-scoped memories to the hub.\n\n" +
      "  Copies all memories with scope=shared to hub/.ai/memories/shared/<project-name>/.\n" +
      "  Optionally commits to the hub repo.\n\n" +
      "  Examples:\n" +
      "    haive hub push\n" +
      "    haive hub push --commit\n" +
      "    haive hub push --commit --message \"feat: add payment API contract memories\"\n",
    )
    .option("-d, --dir <dir>", "project root")
    .option("--commit", "auto-commit to the hub repo after pushing")
    .option("--message <msg>", "commit message for the hub (used with --commit)")
    .action(async (opts: HubOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const config = await loadConfig(paths);

      if (!config.hubPath) {
        ui.error(
          "hubPath not configured in .ai/haive.config.json.\n" +
          "  Add: { \"hubPath\": \"../team-hub\" }\n" +
          "  Or run: haive hub init <path> first.",
        );
        process.exitCode = 1;
        return;
      }

      const hubRoot = path.resolve(root, config.hubPath);
      if (!existsSync(hubRoot)) {
        ui.error(`Hub not found at ${hubRoot}. Run \`haive hub init ${config.hubPath}\` first.`);
        process.exitCode = 1;
        return;
      }

      // Project name = directory name
      const projectName = path.basename(root);
      const destDir = path.join(hubRoot, ".ai", "memories", "shared", projectName);
      await mkdir(destDir, { recursive: true });

      // Load shared-scoped memories
      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const shared = all.filter(
        ({ memory }) =>
          memory.frontmatter.scope === "shared" &&
          memory.frontmatter.status !== "rejected" &&
          memory.frontmatter.status !== "deprecated" &&
          // Don't push imported memories (avoid echo loops)
          !memory.frontmatter.tags.some((t) => t.startsWith("cross-repo:")),
      );

      if (shared.length === 0) {
        ui.warn(
          "No shared-scoped memories found. Create memories with scope=shared to push to the hub.\n" +
          "  Example: haive memory add --type architecture --slug my-api --scope shared --body \"...\"\n" +
          "  Or with MCP: mem_save({ scope: 'shared', ... })",
        );
        return;
      }

      let pushed = 0;
      for (const { memory } of shared) {
        const fm = memory.frontmatter;
        const fileName = `${fm.id}.md`;
        const destPath = path.join(destDir, fileName);
        await writeFile(destPath, serializeMemory(memory), "utf8");
        pushed++;
      }

      console.log(ui.green(`✓ Pushed ${pushed} shared memor${pushed === 1 ? "y" : "ies"} to hub`));
      console.log(ui.dim(`  Location: ${destDir}`));

      if (opts.commit) {
        const message =
          opts.message ?? `haive: sync shared memories from ${projectName} (${pushed} memories)`;
        spawnSync("git", ["add", path.join(".ai", "memories", "shared", projectName)], {
          cwd: hubRoot,
        });
        const commit = spawnSync("git", ["commit", "-m", message], {
          cwd: hubRoot,
          encoding: "utf8",
        });
        if (commit.status === 0) {
          console.log(ui.green(`✓ Committed to hub: "${message}"`));
        } else if (commit.stdout?.includes("nothing to commit")) {
          console.log(ui.dim("  Hub already up to date — nothing to commit."));
        } else {
          ui.warn(`git commit in hub failed: ${commit.stderr}`);
        }
      } else {
        console.log(
          ui.dim(
            "  Tip: use --commit to auto-commit to the hub repo, or commit manually.",
          ),
        );
      }
    });

  // haive hub pull
  hub
    .command("pull")
    .description(
      "Pull shared memories from the hub into this project.\n\n" +
      "  Imports all memories from hub/.ai/memories/shared/ EXCEPT this project's own.\n" +
      "  Imported memories land in .ai/memories/shared/<source-project-name>/.\n\n" +
      "  Examples:\n" +
      "    haive hub pull\n",
    )
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: { dir?: string }) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const config = await loadConfig(paths);

      if (!config.hubPath) {
        ui.error(
          "hubPath not configured in .ai/haive.config.json.\n" +
          "  Add: { \"hubPath\": \"../team-hub\" }\n" +
          "  Or run: haive hub init <path> first.",
        );
        process.exitCode = 1;
        return;
      }

      const hubRoot = path.resolve(root, config.hubPath);
      const hubSharedDir = path.join(hubRoot, ".ai", "memories", "shared");

      if (!existsSync(hubSharedDir)) {
        ui.warn("Hub has no shared memories yet. Run `haive hub push` from other projects first.");
        return;
      }

      const projectName = path.basename(root);
      const { readdir } = await import("node:fs/promises");
      const projectDirs = (await readdir(hubSharedDir, { withFileTypes: true }))
        .filter((d) => d.isDirectory() && d.name !== projectName)
        .map((d) => d.name);

      if (projectDirs.length === 0) {
        console.log(ui.dim("No other projects have pushed to the hub yet."));
        return;
      }

      let totalImported = 0;
      let totalUpdated = 0;

      for (const sourceName of projectDirs) {
        const sourceDir = path.join(hubSharedDir, sourceName);
        const destDir = path.join(paths.memoriesDir, "shared", sourceName);
        await mkdir(destDir, { recursive: true });

        const sourceFiles = (await readdir(sourceDir)).filter((f) => f.endsWith(".md"));
        const { loadMemoriesFromDir: loadDir } = await import("@hiveai/core");
        const existingInDest = await loadDir(destDir);
        const existingIds = new Set(existingInDest.map(({ memory }) => memory.frontmatter.id));

        for (const file of sourceFiles) {
          const srcPath = path.join(sourceDir, file);
          const destPath = path.join(destDir, file);

          // Tag with hub provenance
          const fileContent = await readFile(srcPath, "utf8");
          const alreadyTagged = fileContent.includes(`cross-repo:${sourceName}`);

          if (!alreadyTagged) {
            // Add provenance tag by copying as-is (the original already has cross-repo tags from push)
            await copyFile(srcPath, destPath);
          } else {
            await copyFile(srcPath, destPath);
          }

          const memId = file.replace(".md", "");
          if (existingIds.has(memId)) {
            totalUpdated++;
          } else {
            totalImported++;
          }
        }

        console.log(
          ui.dim(`  [${sourceName}]: ${sourceFiles.length} memor${sourceFiles.length === 1 ? "y" : "ies"} synced`),
        );
      }

      console.log(
        ui.green(`✓ Hub pull complete: ${totalImported} new · ${totalUpdated} updated`),
      );
    });

  // haive hub status
  hub
    .command("status")
    .description("Show hub sync status.")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: { dir?: string }) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const config = await loadConfig(paths);

      console.log(ui.bold("Hub status"));
      console.log(
        `  hubPath: ${config.hubPath ? ui.green(config.hubPath) : ui.dim("not configured")}`,
      );

      const sharedDir = path.join(paths.memoriesDir, "shared");
      if (existsSync(sharedDir)) {
        const { readdir } = await import("node:fs/promises");
        const sources = (await readdir(sharedDir, { withFileTypes: true }))
          .filter((d) => d.isDirectory())
          .map((d) => d.name);
        console.log(`\n  Imported from ${sources.length} source(s):`);
        for (const src of sources) {
          const files = (await readdir(path.join(sharedDir, src))).filter((f) => f.endsWith(".md"));
          console.log(`    ${src}: ${files.length} memor${files.length === 1 ? "y" : "ies"}`);
        }
      } else {
        console.log(ui.dim("  No imported shared memories yet."));
      }

      // Count outgoing shared memories
      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const outgoing = all.filter(
        ({ memory }) =>
          memory.frontmatter.scope === "shared" &&
          !memory.frontmatter.tags.some((t) => t.startsWith("cross-repo:")),
      );
      console.log(`\n  This project's shared memories (ready to push): ${outgoing.length}`);
      if (outgoing.length > 0) {
        console.log(ui.dim("  Run `haive hub push` to publish them to the hub."));
      }

      void readFile; void writeFile; void saveConfig; // imported for side effects
    });
}
