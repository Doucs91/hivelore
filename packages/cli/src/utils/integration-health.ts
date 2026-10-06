import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { readMcpRuntimeInstances, resolveHaivePaths } from "@hivelore/core";
import { detectStaleGitHooks } from "../commands/enforce.js";
declare const __HAIVE_VERSION__: string;
export async function integrationHealth(root: string) {
  const active = await readMcpRuntimeInstances(resolveHaivePaths(root));
  const staleHooks = await detectStaleGitHooks(root);
  const workflows = path.join(root, ".github/workflows");
  const legacyCi: string[] = [];
  for (const file of await readdir(workflows).catch(() => [])) {
    if (!/\.ya?ml$/.test(file)) continue;
    const body = await readFile(path.join(workflows, file), "utf8").catch(() => "");
    if (/hivelore|haive/i.test(body) && /sync-on-merge|git push/.test(body) && /(?:hivelore|haive) sync/.test(body)) legacyCi.push(`.github/workflows/${file}`);
  }
  return { cli_version: __HAIVE_VERSION__, active_servers: active,
    stale_hooks: staleHooks, legacy_ci_workflows: legacyCi,
    restart_required: active.some(m => m.version !== __HAIVE_VERSION__),
    active_session: "unverified" as const,
    repair_command: "hivelore agent setup --no-global",
    note: "A fresh handshake does not upgrade an existing conversation. Restart the client and check get_briefing.server_version. Legacy CI candidates require review before replacement." };
}
