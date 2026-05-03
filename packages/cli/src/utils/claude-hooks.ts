/**
 * Patch a Claude Code settings.json file with hAIve passive-capture hooks.
 *
 * Claude Code's hook format:
 *   { "hooks": { "PostToolUse": [{ "matcher": "...", "hooks": [{ "type":"command", "command":"..." }] }] } }
 *
 * We add two hAIve-marked entries so we can find and replace them on re-runs:
 *   - PostToolUse → `haive observe`   (matcher: Edit|Write|Bash)
 *   - SessionEnd  → `haive session-end --quiet`
 *
 * Existing user-defined hooks are preserved untouched.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const HAIVE_HOOK_TAG = "haive-passive-capture";

interface ClaudeHookEntry {
  type: "command";
  command: string;
  /** hAIve marker so we can identify our own entries on re-runs. */
  haive_tag?: string;
}

interface ClaudeHookGroup {
  matcher?: string;
  hooks: ClaudeHookEntry[];
}

interface ClaudeSettings {
  hooks?: Record<string, ClaudeHookGroup[]>;
  [key: string]: unknown;
}

const POST_TOOL_USE_GROUP: ClaudeHookGroup = {
  matcher: "Edit|Write|Bash",
  hooks: [
    {
      type: "command",
      command: "haive observe",
      haive_tag: HAIVE_HOOK_TAG,
    },
  ],
};

const SESSION_END_GROUP: ClaudeHookGroup = {
  hooks: [
    {
      type: "command",
      command: "haive session-end --quiet --auto",
      haive_tag: HAIVE_HOOK_TAG,
    },
  ],
};

function dropHaiveGroups(groups: ClaudeHookGroup[]): ClaudeHookGroup[] {
  return groups.filter(
    (g) => !g.hooks.some((h) => h.haive_tag === HAIVE_HOOK_TAG),
  );
}

export function patchClaudeSettings(input: ClaudeSettings | null): ClaudeSettings {
  const settings: ClaudeSettings = input ? { ...input } : {};
  const hooks = settings.hooks ? { ...settings.hooks } : {};
  hooks.PostToolUse = [
    ...dropHaiveGroups(hooks.PostToolUse ?? []),
    POST_TOOL_USE_GROUP,
  ];
  hooks.SessionEnd = [
    ...dropHaiveGroups(hooks.SessionEnd ?? []),
    SESSION_END_GROUP,
  ];
  settings.hooks = hooks;
  return settings;
}

export function unpatchClaudeSettings(input: ClaudeSettings | null): ClaudeSettings {
  const settings: ClaudeSettings = input ? { ...input } : {};
  if (!settings.hooks) return settings;
  const hooks = { ...settings.hooks };
  for (const [event, groups] of Object.entries(hooks)) {
    const cleaned = dropHaiveGroups(groups);
    if (cleaned.length === 0) {
      delete hooks[event];
    } else {
      hooks[event] = cleaned;
    }
  }
  settings.hooks = hooks;
  if (Object.keys(hooks).length === 0) delete settings.hooks;
  return settings;
}

export interface ClaudeHooksInstallResult {
  settingsPath: string;
  created: boolean;
}

export async function installClaudeHooksAtPath(
  settingsPath: string,
): Promise<ClaudeHooksInstallResult> {
  let raw: ClaudeSettings | null = null;
  let created = false;
  if (existsSync(settingsPath)) {
    try {
      raw = JSON.parse(await readFile(settingsPath, "utf8")) as ClaudeSettings;
    } catch {
      throw new Error(`${settingsPath} exists but is not valid JSON. Fix it manually first.`);
    }
  } else {
    created = true;
  }
  const patched = patchClaudeSettings(raw);
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(patched, null, 2) + "\n", "utf8");
  return { settingsPath, created };
}

export async function uninstallClaudeHooksAtPath(
  settingsPath: string,
): Promise<ClaudeHooksInstallResult> {
  if (!existsSync(settingsPath)) {
    return { settingsPath, created: false };
  }
  const raw = JSON.parse(await readFile(settingsPath, "utf8")) as ClaudeSettings;
  const cleaned = unpatchClaudeSettings(raw);
  await writeFile(settingsPath, JSON.stringify(cleaned, null, 2) + "\n", "utf8");
  return { settingsPath, created: false };
}

export function defaultClaudeSettingsPath(scope: "user" | "project", projectRoot: string): string {
  if (scope === "user") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return path.join(home, ".claude", "settings.json");
  }
  return path.join(projectRoot, ".claude", "settings.local.json");
}
