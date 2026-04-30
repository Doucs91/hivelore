/**
 * hAIve project configuration — .ai/haive.config.json
 *
 * In autopilot mode, hAIve operates with zero human intervention:
 *   - Memories go directly to `validated` (no approval cycle)
 *   - `haive sync` auto-approves proposed memories after the delay
 *   - The MCP server saves a session recap automatically on exit
 *   - `get_briefing` auto-generates a minimal project context if none exists
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { HaivePaths } from "./paths.js";

export const CONFIG_FILE = "haive.config.json";

export interface HaiveConfig {
  /** Autopilot mode: maximum autonomy, minimum human intervention. Default: false. */
  autopilot?: boolean;

  /** Default scope for new memories. Default: "personal". Autopilot sets "team". */
  defaultScope?: "personal" | "team";

  /**
   * Default status for new memories saved via mem_save.
   * Autopilot sets "validated" — skips the approval cycle entirely.
   * Default: "draft".
   */
  defaultStatus?: "draft" | "validated";

  /** Auto-approve proposed memories after N hours without rejection. Default: null (disabled). */
  autoApproveDelayHours?: number | null;

  /**
   * Auto-promote proposed→validated after N reads (overrides DEFAULT_AUTO_PROMOTE_RULE).
   * Autopilot sets 1 (immediate on first use).
   */
  autoPromoteMinReads?: number;

  /** Auto-save session recap on MCP server exit. Default: true in autopilot, false otherwise. */
  autoSessionEnd?: boolean;

  /**
   * Auto-generate a minimal project context from code-map when project-context.md is still
   * the template. Default: true in autopilot, false otherwise.
   */
  autoContext?: boolean;
}

export const DEFAULT_CONFIG: HaiveConfig = {
  autopilot: false,
  defaultScope: "personal",
  defaultStatus: "draft",
  autoApproveDelayHours: null,
  autoPromoteMinReads: 5,
  autoSessionEnd: false,
  autoContext: false,
};

export const AUTOPILOT_DEFAULTS: HaiveConfig = {
  autopilot: true,
  defaultScope: "team",
  defaultStatus: "validated",
  autoApproveDelayHours: 72,
  autoPromoteMinReads: 1,
  autoSessionEnd: true,
  autoContext: true,
};

export function configPath(paths: HaivePaths): string {
  return path.join(paths.haiveDir, CONFIG_FILE);
}

export async function loadConfig(paths: HaivePaths): Promise<HaiveConfig> {
  const file = configPath(paths);
  if (!existsSync(file)) return { ...DEFAULT_CONFIG };
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<HaiveConfig>;
    const merged = { ...DEFAULT_CONFIG, ...parsed };
    // In autopilot mode, apply autopilot defaults for any field not explicitly set
    if (merged.autopilot) {
      return { ...AUTOPILOT_DEFAULTS, ...parsed };
    }
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(paths: HaivePaths, config: HaiveConfig): Promise<void> {
  await writeFile(configPath(paths), JSON.stringify(config, null, 2) + "\n", "utf8");
}
