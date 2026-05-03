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

const POST_MERGE_BODY = `#!/bin/sh
${HOOK_MARKER} — keep this block to allow upgrades. Hand-edit anything outside it.

# After a merge or pull, refresh memory anchors and auto-promote eligible
# memories so that everyone on this branch sees consistent confidence levels.
if command -v haive >/dev/null 2>&1; then
  haive sync --quiet --since ORIG_HEAD || true
elif [ -x ./node_modules/.bin/haive ]; then
  ./node_modules/.bin/haive sync --quiet --since ORIG_HEAD || true
fi
`;

const PRE_PUSH_BODY = `#!/bin/sh
${HOOK_MARKER} — keep this block to allow upgrades. Hand-edit anything outside it.

# Before pushing, run haive precommit to surface known anti-patterns and stale memories.
# Exit 0 always — this is advisory only (set HAIVE_BLOCK=1 to make it blocking).
HAIVE_BLOCK=\${HAIVE_BLOCK:-0}

_haive() {
  if command -v haive >/dev/null 2>&1; then haive "$@"
  elif [ -x ./node_modules/.bin/haive ]; then ./node_modules/.bin/haive "$@"
  else return 0
  fi
}

# Run pre-commit check on diff between local and remote
LOCAL_BRANCH=\$(git rev-parse --abbrev-ref HEAD)
REMOTE_SHA=\$(git rev-parse --verify "@{u}" 2>/dev/null || echo "")
if [ -n "\$REMOTE_SHA" ]; then
  DIFF=\$(git diff "\$REMOTE_SHA"..HEAD 2>/dev/null || "")
  if [ -n "\$DIFF" ]; then
    _haive precommit --quiet 2>/dev/null || true
  fi
fi

# Remind agent to save session recap if env var is set
if [ "\$HAIVE_SESSION_REMINDER" = "1" ]; then
  echo "haive: session active — remember to call mem_session_end before closing." >&2
fi

exit 0
`;

const HOOKS: { name: string; body: string }[] = [
  { name: "post-merge",   body: POST_MERGE_BODY },
  { name: "post-rewrite", body: POST_MERGE_BODY },
  { name: "pre-push",     body: PRE_PUSH_BODY },
];

export function registerInstallHooks(program: Command): void {
  program
    .command("install-hooks")
    .description(
      "Install git hooks so haive sync runs automatically after every pull or merge.\n\n" +
      "  Installs:\n" +
      "    post-merge / post-rewrite — runs haive sync after every pull/merge\n" +
      "    pre-push                  — runs haive precommit before every push (advisory)\n\n" +
      "  Installed automatically by haive init (autopilot mode).\n" +
      "  Use --force to overwrite existing hooks.\n",
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
      for (const { name, body } of HOOKS) {
        const file = path.join(hooksDir, name);
        if (existsSync(file) && !opts.force) {
          const existing = await readFile(file, "utf8");
          if (!existing.includes(HOOK_MARKER)) {
            ui.warn(`${name} already exists and was not written by hAIve. Re-run with --force to overwrite.`);
            skipped++;
            continue;
          }
        }
        await writeFile(file, body, "utf8");
        await chmod(file, 0o755);
        installed++;
      }
      ui.success(`Installed ${installed} hook(s) in .git/hooks/${skipped ? `, skipped ${skipped}` : ""}`);
      ui.info("post-merge: haive sync runs after every pull/merge.");
      ui.info("pre-push:   haive precommit runs before every push (advisory, never blocks).");
      ui.info("           Set HAIVE_BLOCK=1 in your shell to make pre-push blocking.");
    });
}
