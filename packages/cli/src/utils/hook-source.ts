/**
 * Hooks can reach Hivelore twice: from the project/user settings `hivelore init` patched, and from the
 * Claude Code plugin. The plugin's wrapper sets HIVELORE_HOOK_SOURCE=plugin; when the settings already
 * carry Hivelore's own hooks, the plugin copy steps aside so nothing fires twice.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { HAIVE_HOOK_TAG } from "./claude-hooks.js";

function settingsHaveHiveloreHooks(file: string): boolean {
  try {
    return existsSync(file) && readFileSync(file, "utf8").includes(`"${HAIVE_HOOK_TAG}"`);
  } catch {
    return false;
  }
}

/** True when this hook call came from the plugin AND the settings already run Hivelore's hooks. */
export function pluginHookShadowed(root: string | null, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env["HIVELORE_HOOK_SOURCE"] !== "plugin") return false;
  const candidates = [path.join(os.homedir(), ".claude", "settings.json")];
  if (root) candidates.push(path.join(root, ".claude", "settings.json"), path.join(root, ".claude", "settings.local.json"));
  return candidates.some(settingsHaveHiveloreHooks);
}
