import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { BRIDGE_TARGET_PATH, BRIDGE_TARGETS, type BridgeTarget } from "@hivelore/core";

export interface BridgeDetection {
  targets: BridgeTarget[];
  /** target → why it was selected ("installed" machine signal | "repo file" already present). */
  reasons: Partial<Record<BridgeTarget, "installed" | "repo file" | "universal">>;
}

/** VS Code extension-id prefixes that identify a client living inside VS Code. */
const VSCODE_EXTENSION_SIGNALS: Partial<Record<BridgeTarget, string[]>> = {
  copilot: ["github.copilot"],
  cline: ["saoudrizwan.claude-dev"],
  roo: ["rooveterinaryinc.roo"],
  cody: ["sourcegraph.cody"],
  continue: ["continue.continue"],
};

/** Home-relative paths whose existence marks a client as installed on this machine. */
const HOME_SIGNALS: Partial<Record<BridgeTarget, string[]>> = {
  claude: [".claude", ".claude.json"],
  cursor: [".cursor"],
  windsurf: [".codeium/windsurf", ".windsurf"],
  gemini: [".gemini"],
  continue: [".continue"],
  aider: [".aider.conf.yml", ".aider"],
  zed: [".config/zed", "Library/Application Support/Zed"],
  copilot: [".config/github-copilot"],
};

/** Env vars set when the corresponding agent is the one running right now. */
const ENV_SIGNALS: Partial<Record<BridgeTarget, string[]>> = {
  claude: ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"],
  cursor: ["CURSOR_AGENT"],
  gemini: ["GEMINI_CLI"],
  aider: ["AIDER_MODEL"],
};

function vscodeExtensionIds(home: string): string[] {
  const ids: string[] = [];
  for (const dir of [".vscode/extensions", ".vscode-server/extensions", ".vscode-oss/extensions"]) {
    try {
      ids.push(...readdirSync(path.join(home, dir)).map((e) => e.toLowerCase()));
    } catch {
      /* not installed */
    }
  }
  return ids;
}

/**
 * Detect which agent clients this machine/repo actually uses, so `hivelore init`
 * generates bridges for them instead of dropping all 12 files at the repo root.
 * AGENTS.md is always included — it is the cross-tool standard many clients read.
 * A bridge file already present in the repo keeps its target (someone uses it).
 */
export function detectBridgeTargets(
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): BridgeDetection {
  const reasons: BridgeDetection["reasons"] = { agents: "universal" };
  const extensions = vscodeExtensionIds(home);

  for (const target of BRIDGE_TARGETS) {
    if (target === "agents") continue;
    if (existsSync(path.join(root, BRIDGE_TARGET_PATH[target]))) {
      reasons[target] = "repo file";
      continue;
    }
    const homeHit = (HOME_SIGNALS[target] ?? []).some((p) => existsSync(path.join(home, p)));
    const envHit = (ENV_SIGNALS[target] ?? []).some((v) => env[v]);
    const extHit = (VSCODE_EXTENSION_SIGNALS[target] ?? []).some((prefix) =>
      extensions.some((id) => id.startsWith(prefix)),
    );
    if (homeHit || envHit || extHit) reasons[target] = "installed";
  }

  return {
    targets: BRIDGE_TARGETS.filter((t) => t in reasons),
    reasons,
  };
}
