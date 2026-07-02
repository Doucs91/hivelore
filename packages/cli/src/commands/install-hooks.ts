import { mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProjectRoot } from "@hivelore/core";
import { ui } from "../utils/ui.js";
import {
  defaultClaudeSettingsPath,
  installClaudeHooksAtPath,
  uninstallClaudeHooksAtPath,
} from "../utils/claude-hooks.js";

interface InstallHooksOptions {
  dir?: string;
  force?: boolean;
  scope?: "user" | "project";
  uninstall?: boolean;
  settings?: string;
}

type Target = "git" | "claude";

const HOOK_MARKER = "# Hivelore auto-generated";

// Every generated hook resolves the CLI through the same probe: the new `hivelore` binary
// first, the legacy `haive` alias next (older global installs), then local node_modules bins.
const RESOLVE_CLI = `_hivelore() {
  if command -v hivelore >/dev/null 2>&1; then hivelore "$@"
  elif command -v haive >/dev/null 2>&1; then haive "$@"
  elif [ -x ./node_modules/.bin/hivelore ]; then ./node_modules/.bin/hivelore "$@"
  elif [ -x ./node_modules/.bin/haive ]; then ./node_modules/.bin/haive "$@"
  else return 0
  fi
}`;

const POST_MERGE_BODY = `#!/bin/sh
${HOOK_MARKER} — keep this block to allow upgrades. Hand-edit anything outside it.

# After a merge or pull, refresh memory anchors and auto-promote eligible
# memories so that everyone on this branch sees consistent confidence levels.
${RESOLVE_CLI}

_hivelore sync --quiet --since ORIG_HEAD || true
`;

const PRE_PUSH_BODY = `#!/bin/sh
${HOOK_MARKER} — keep this block to allow upgrades. Hand-edit anything outside it.

# Before pushing, run the Hivelore workflow policy gate. This is blocking by default:
# initialized projects should not accept AI changes that bypass Hivelore.
${RESOLVE_CLI}

_hivelore enforce check --stage pre-push --dir . || exit $?

# Remind agent to save session recap if env var is set
if [ "\$HAIVE_SESSION_REMINDER" = "1" ]; then
  echo "hivelore: session active — remember to call mem_session_end before closing." >&2
fi

exit 0
`;

const HOOKS: { name: string; body: string }[] = [
  { name: "post-merge",   body: POST_MERGE_BODY },
  { name: "post-rewrite", body: POST_MERGE_BODY },
  { name: "pre-push",     body: PRE_PUSH_BODY },
  {
    name: "pre-commit",
    body: `#!/bin/sh
${HOOK_MARKER} — keep this block to allow upgrades. Hand-edit anything outside it.
${RESOLVE_CLI}

_hivelore enforce check --stage pre-commit --dir . || exit $?
`,
  },
];

async function installGitHooks(opts: InstallHooksOptions): Promise<void> {
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
        ui.warn(`${name} already exists and was not written by Hivelore. Re-run with --force to overwrite.`);
        skipped++;
        continue;
      }
    }
    await writeFile(file, body, "utf8");
    await chmod(file, 0o755);
    installed++;
  }
  ui.success(`Installed ${installed} git hook(s) in .git/hooks/${skipped ? `, skipped ${skipped}` : ""}`);
  ui.info("post-merge: hivelore sync runs after every pull/merge.");
  ui.info("pre-commit: hivelore enforce check blocks unsafe staged changes.");
  ui.info("pre-push:   hivelore enforce check blocks pushes that bypass briefing/session recap policy.");
}

async function installClaudeHooks(opts: InstallHooksOptions): Promise<void> {
  const root = findProjectRoot(opts.dir);
  const scope = opts.scope ?? "user";
  const settingsPath = opts.settings ?? defaultClaudeSettingsPath(scope, root);

  if (opts.uninstall) {
    const result = await uninstallClaudeHooksAtPath(settingsPath);
    ui.success(`Removed Hivelore hooks from ${result.settingsPath}`);
    return;
  }

  try {
    const result = await installClaudeHooksAtPath(settingsPath);
    if (result.created) {
      ui.success(`Created ${result.settingsPath} with Hivelore enforcement hooks`);
    } else {
      ui.success(`Patched ${result.settingsPath} (existing user hooks preserved)`);
    }
  } catch (err) {
    ui.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  ui.info("SessionStart hook: `hivelore enforce session-start` injects briefing context");
  ui.info("PreToolUse hook:   blocks Edit/Write/dangerous Bash until briefing is loaded");
  ui.info("PostToolUse hook:  `hivelore observe` captures Edit/Write/Bash activity");
  ui.info("SessionEnd hook:   `hivelore session end --auto --quiet` distills observations");
  ui.info("                   into a session_recap memory at session close");
  ui.info("Restart Claude Code (or open a new conversation) for the hooks to take effect.");
  ui.info(`Run \`hivelore install-hooks claude --uninstall\` to remove.`);
}

export function registerInstallHooks(program: Command): void {
  program
    .command("install-hooks [target]")
    .description(
      "Install Hivelore hooks (same effect as `hivelore enforce install`, kept for back-compat). Targets:\n\n" +
      "    git     (default) post-merge / post-rewrite / pre-push for hivelore sync + precommit\n" +
      "    claude  SessionStart + PreToolUse + PostToolUse + SessionEnd hooks\n" +
      "            for briefing injection, pre-edit blocking, and capture (Claude Code only)\n\n" +
      "  Examples:\n" +
      "    hivelore install-hooks           # git hooks (legacy default)\n" +
      "    hivelore install-hooks git\n" +
      "    hivelore install-hooks claude\n" +
      "    hivelore install-hooks claude --scope project\n" +
      "    hivelore install-hooks claude --uninstall\n",
    )
    .option("-d, --dir <dir>", "project root")
    .option("--force", "overwrite existing hooks (git target only)")
    .option("--scope <scope>", "claude target: 'user' (~/.claude) or 'project' (.claude/)", "user")
    .option("--uninstall", "remove previously installed Hivelore hooks (claude target only)")
    .option("--settings <path>", "explicit path to settings.json (claude target only)")
    .action(async (target: string | undefined, opts: InstallHooksOptions) => {
      const t = (target ?? "git").toLowerCase() as Target | string;
      if (t === "git") {
        await installGitHooks(opts);
      } else if (t === "claude") {
        await installClaudeHooks(opts);
      } else {
        ui.error(`Unknown target: ${target}. Available: git, claude`);
        process.exitCode = 1;
      }
    });
}
