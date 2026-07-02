/**
 * `hivelore release` — kill the release ritual.
 *
 * The repo protocol used to be manual: sed the same version into 5 package.json files,
 * hand-edit the CHANGELOG, commit, `git tag vX.Y.Z`, push branch + tag, then babysit
 * `gh run watch` before `enforce finish`. Two verbs replace it:
 *
 *   hivelore release bump patch|minor|major|X.Y.Z [--title "…"]
 *     → lockstep-bump the publishable manifests + insert a CHANGELOG section scaffold.
 *   hivelore release tag
 *     → after the bump commit: verify lockstep + not-already-tagged, create vX.Y.Z at
 *       HEAD, push branch and that one tag (never `--tags`).
 *
 * npm publication stays a human step by policy (`pnpm run publish:all`).
 */
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { findProjectRoot } from "@hivelore/core";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ui } from "../utils/ui.js";

const exec = promisify(execFile);

/** The publishable lockstep set (mirrors VERSION_FILES in enforce.ts). */
const VERSION_FILES = [
  "package.json",
  "packages/core/package.json",
  "packages/cli/package.json",
  "packages/mcp/package.json",
  "packages/embeddings/package.json",
] as const;

async function readCurrentVersion(root: string): Promise<string> {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { version?: string };
  if (!pkg.version) throw new Error("Root package.json has no version field.");
  return pkg.version;
}

function nextVersion(current: string, spec: string): string {
  if (/^\d+\.\d+\.\d+$/.test(spec)) return spec;
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) throw new Error(`Current version "${current}" is not X.Y.Z — pass an explicit version.`);
  const [major, minor, patch] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (spec === "patch") return `${major}.${minor}.${patch + 1}`;
  if (spec === "minor") return `${major}.${minor + 1}.0`;
  if (spec === "major") return `${major + 1}.0.0`;
  throw new Error(`Unknown bump "${spec}" — use patch | minor | major | X.Y.Z.`);
}

export function registerRelease(program: Command): void {
  const release = program
    .command("release")
    .description("Release protocol helpers: lockstep version bump + CHANGELOG scaffold, then tag + push.");

  release
    .command("bump <version>")
    .description("Bump root + core/cli/mcp/embeddings in lockstep (patch|minor|major|X.Y.Z) and scaffold the CHANGELOG section.")
    .option("--title <text>", "CHANGELOG section title (after the version)")
    .option("-d, --dir <dir>", "project root")
    .action(async (spec: string, opts: { title?: string; dir?: string }) => {
      const root = findProjectRoot(opts.dir);
      const current = await readCurrentVersion(root);
      const next = nextVersion(current, spec);

      for (const rel of VERSION_FILES) {
        const file = path.join(root, rel);
        if (!existsSync(file)) { ui.warn(`skip ${rel} (missing)`); continue; }
        const raw = await readFile(file, "utf8");
        const updated = raw.replace(`"version": "${current}"`, `"version": "${next}"`);
        if (updated === raw) {
          ui.error(`${rel} is not at ${current} — lockstep broken; fix versions manually first.`);
          process.exitCode = 1;
          return;
        }
        await writeFile(file, updated, "utf8");
      }

      const changelog = path.join(root, "CHANGELOG.md");
      if (existsSync(changelog)) {
        const raw = await readFile(changelog, "utf8");
        const heading = `## [${next}]${opts.title ? ` — ${opts.title}` : ""}`;
        if (!raw.includes(`## [${next}]`)) {
          await writeFile(
            changelog,
            raw.replace("## [Unreleased]", `## [Unreleased]\n\n${heading}\n\n- TODO: describe the changes.\n`),
            "utf8",
          );
        }
      }

      ui.success(`Bumped ${current} → ${next} across ${VERSION_FILES.length} manifest(s); CHANGELOG scaffolded.`);
      ui.info("Next: fill the CHANGELOG entry, build/test, commit (the gate runs), then `hivelore release tag`.");
    });

  release
    .command("tag")
    .description("Create vX.Y.Z at HEAD (from the lockstep version), push the branch and that one tag.")
    .option("--no-push", "create the tag locally without pushing")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: { push?: boolean; dir?: string }) => {
      const root = findProjectRoot(opts.dir);
      const version = await readCurrentVersion(root);

      // Lockstep sanity — mirrors the enforce finish check so tagging can't outrun a partial bump.
      for (const rel of VERSION_FILES.slice(1)) {
        const file = path.join(root, rel);
        if (!existsSync(file)) continue;
        const v = (JSON.parse(await readFile(file, "utf8")) as { version?: string }).version;
        if (v !== version) {
          ui.error(`${rel} is at ${v}, root at ${version} — lockstep broken; run \`hivelore release bump\` first.`);
          process.exitCode = 1;
          return;
        }
      }

      const dirty = (await exec("git", ["status", "--porcelain"], { cwd: root })).stdout.trim();
      if (dirty.length > 0) {
        ui.error("Working tree is not clean — commit the bump before tagging.");
        process.exitCode = 1;
        return;
      }

      const tag = `v${version}`;
      const existing = (await exec("git", ["tag", "--list", tag], { cwd: root })).stdout.trim();
      if (existing) {
        ui.error(`Tag ${tag} already exists — bump the version first.`);
        process.exitCode = 1;
        return;
      }

      await exec("git", ["tag", tag], { cwd: root });
      ui.success(`Created ${tag} at HEAD.`);
      if (opts.push !== false) {
        // Push the branch and ONLY the new tag — never `--tags` (stale local tags collide upstream).
        await exec("git", ["push"], { cwd: root });
        await exec("git", ["push", "origin", tag], { cwd: root });
        ui.success(`Pushed branch and ${tag}.`);
        ui.info("Next: `hivelore enforce finish --wait` (polls CI), then publish via `pnpm run publish:all` (human step).");
      }
    });
}
