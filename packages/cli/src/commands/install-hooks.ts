import { mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProjectRoot } from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface InstallHooksOptions {
  dir?: string;
  force?: boolean;
}

const HOOK_MARKER = "# hAIve auto-generated";

const HOOK_BODY = `#!/bin/sh
${HOOK_MARKER} — keep this block to allow upgrades. Hand-edit anything outside it.

# After a merge or pull, refresh memory anchors and auto-promote eligible
# memories so that everyone on this branch sees consistent confidence levels.
if command -v haive >/dev/null 2>&1; then
  haive sync --quiet --since ORIG_HEAD || true
elif [ -x ./node_modules/.bin/haive ]; then
  ./node_modules/.bin/haive sync --quiet --since ORIG_HEAD || true
fi
`;

const HOOKS = ["post-merge", "post-rewrite"] as const;

export function registerInstallHooks(program: Command): void {
  program
    .command("install-hooks")
    .description(
      "Install git hooks so haive sync runs automatically after every pull or merge.\n\n" +
      "  Installs a post-merge hook at .git/hooks/post-merge that runs:\n" +
      "    haive sync --quiet --since ORIG_HEAD --embed\n\n" +
      "  This ensures memory anchors are always verified and the embeddings index\n" +
      "  is kept fresh without requiring any manual steps.\n\n" +
      "  Installed automatically by haive init (autopilot mode).\n" +
      "  Use --force to overwrite an existing post-merge hook.\n",
    )
    .option("-d, --dir <dir>", "project root")
    .option("--force", "overwrite existing hooks")
    .action(async (opts: InstallHooksOptions) => {
      const root = findProjectRoot(opts.dir);
      const gitDir = path.join(root, ".git");
      if (!existsSync(gitDir)) {
        ui.error(`No .git directory at ${root}.`);
        process.exitCode = 1;
        return;
      }
      const hooksDir = path.join(gitDir, "hooks");
      await mkdir(hooksDir, { recursive: true });

      let installed = 0;
      let skipped = 0;
      for (const name of HOOKS) {
        const file = path.join(hooksDir, name);
        if (existsSync(file) && !opts.force) {
          const existing = await readFile(file, "utf8");
          if (!existing.includes(HOOK_MARKER)) {
            ui.warn(`${name} already exists and was not written by hAIve. Re-run with --force to overwrite.`);
            skipped++;
            continue;
          }
        }
        await writeFile(file, HOOK_BODY, "utf8");
        await chmod(file, 0o755);
        installed++;
      }
      ui.success(`Installed ${installed} hook(s) in .git/hooks/${skipped ? `, skipped ${skipped}` : ""}`);
      ui.info("Test with: git pull (or any merge), then check .ai/memories for status updates.");
    });
}
