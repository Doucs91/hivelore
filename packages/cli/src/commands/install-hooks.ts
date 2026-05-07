import { mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProjectRoot } from "@hiveai/core";
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

# Before pushing, run the hAIve workflow policy gate. This is blocking by default:
# initialized projects should not accept AI changes that bypass hAIve.

_haive() {
  if command -v haive >/dev/null 2>&1; then haive "$@"
  elif [ -x ./node_modules/.bin/haive ]; then ./node_modules/.bin/haive "$@"
  else return 0
  fi
}

_haive enforce check --stage pre-push --dir . || exit $?

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
  {
    name: "pre-commit",
    body: `#!/bin/sh
${HOOK_MARKER} — keep this block to allow upgrades. Hand-edit anything outside it.

if command -v haive >/dev/null 2>&1; then
  haive enforce check --stage pre-commit --dir . || exit $?
elif [ -x ./node_modules/.bin/haive ]; then
  ./node_modules/.bin/haive enforce check --stage pre-commit --dir . || exit $?
fi
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
        ui.warn(`${name} already exists and was not written by hAIve. Re-run with --force to overwrite.`);
        skipped++;
        continue;
      }
    }
    await writeFile(file, body, "utf8");
    await chmod(file, 0o755);
    installed++;
  }
  ui.success(`Installed ${installed} git hook(s) in .git/hooks/${skipped ? `, skipped ${skipped}` : ""}`);
  ui.info("post-merge: haive sync runs after every pull/merge.");
  ui.info("pre-commit: haive enforce check blocks unsafe staged changes.");
  ui.info("pre-push:   haive enforce check blocks pushes that bypass briefing/session recap policy.");
}

async function installClaudeHooks(opts: InstallHooksOptions): Promise<void> {
  const root = findProjectRoot(opts.dir);
  const scope = opts.scope ?? "user";
  const settingsPath = opts.settings ?? defaultClaudeSettingsPath(scope, root);

  if (opts.uninstall) {
    const result = await uninstallClaudeHooksAtPath(settingsPath);
    ui.success(`Removed hAIve hooks from ${result.settingsPath}`);
    return;
  }

  try {
    const result = await installClaudeHooksAtPath(settingsPath);
    if (result.created) {
      ui.success(`Created ${result.settingsPath} with hAIve enforcement hooks`);
    } else {
      ui.success(`Patched ${result.settingsPath} (existing user hooks preserved)`);
    }
  } catch (err) {
    ui.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
    return;
  }

  ui.info("SessionStart hook: `haive enforce session-start` injects briefing context");
  ui.info("PreToolUse hook:   blocks Edit/Write/dangerous Bash until briefing is loaded");
  ui.info("PostToolUse hook:  `haive observe` captures Edit/Write/Bash activity");
  ui.info("SessionEnd hook:   `haive session end --auto --quiet` distills observations");
  ui.info("                   into a session_recap memory at session close");
  ui.info("Restart Claude Code (or open a new conversation) for the hooks to take effect.");
  ui.info(`Run \`haive install-hooks claude --uninstall\` to remove.`);
}

export function registerInstallHooks(program: Command): void {
  program
    .command("install-hooks [target]")
    .description(
      "Install hAIve hooks. Targets:\n\n" +
      "    git     (default) post-merge / post-rewrite / pre-push for haive sync + precommit\n" +
      "    claude  SessionStart + PreToolUse + PostToolUse + SessionEnd hooks\n" +
      "            for briefing injection, pre-edit blocking, and capture (Claude Code only)\n\n" +
      "  Examples:\n" +
      "    haive install-hooks           # git hooks (legacy default)\n" +
      "    haive install-hooks git\n" +
      "    haive install-hooks claude\n" +
      "    haive install-hooks claude --scope project\n" +
      "    haive install-hooks claude --uninstall\n",
    )
    .option("-d, --dir <dir>", "project root")
    .option("--force", "overwrite existing hooks (git target only)")
    .option("--scope <scope>", "claude target: 'user' (~/.claude) or 'project' (.claude/)", "user")
    .option("--uninstall", "remove previously installed hAIve hooks (claude target only)")
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
