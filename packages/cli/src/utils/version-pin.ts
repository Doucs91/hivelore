/**
 * Enforce the repository's pinned CLI version (`cliVersion`) at startup.
 *
 * An OLDER global `hivelore` running a newer repository's hooks silently lacks the newer sensor kinds.
 * When a project-local `@hivelore/cli` of the pinned version exists, hand the whole invocation to it
 * (same argv, same stdin); otherwise warn once a day with the exact command. A newer CLI is tolerated.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadConfigSync, pinVerdict, resolveHaivePaths } from "@hivelore/core";

export function enforcePinnedVersion(projectRoot: string, running: string, argv: string[] = process.argv): void {
  if (process.env["HIVELORE_DELEGATED"] === "1") return;
  const paths = resolveHaivePaths(projectRoot);
  if (!existsSync(paths.haiveDir)) return;
  const pinned = loadConfigSync(paths).cliVersion;
  if (pinVerdict(running, pinned) !== "older") return;

  const localPkg = path.join(projectRoot, "node_modules", "@hivelore", "cli", "package.json");
  try {
    const local = JSON.parse(readFileSync(localPkg, "utf8")) as { version?: string; bin?: Record<string, string> | string };
    if (local.version && pinVerdict(local.version, pinned) !== "older") {
      const entry = path.join(path.dirname(localPkg), "dist", "index.js");
      if (existsSync(entry)) {
        const result = spawnSync(process.execPath, [entry, ...argv.slice(2)], {
          stdio: "inherit",
          env: { ...process.env, HIVELORE_DELEGATED: "1" },
        });
        process.exit(result.status ?? 1);
      }
    }
  } catch { /* no project-local install */ }

  // Warn at most once a day per repository and pinned version.
  const stamp = path.join(paths.cacheDir, "version-pin-warned");
  const today = `${new Date().toISOString().slice(0, 10)} ${pinned}`;
  try {
    if (existsSync(stamp) && readFileSync(stamp, "utf8").trim() === today) return;
    mkdirSync(paths.cacheDir, { recursive: true });
    writeFileSync(stamp, today, "utf8");
  } catch { /* still warn */ }
  process.stderr.write(
    `hivelore: this repository pins @hivelore/cli ${pinned}, but ${running} is running — newer rules (e.g. command guards) ` +
    `are not enforced by it. Update: npm install -g @hivelore/cli@${pinned}\n`,
  );
}
