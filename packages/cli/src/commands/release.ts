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
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { ui } from "../utils/ui.js";

const exec = promisify(execFile);

/**
 * Lockstep-verify, refuse a dirty tree or an existing tag, create vX.Y.Z at HEAD and (unless push is
 * false) push the branch and that ONE tag. Shared by `release tag` and `release ship`. Returns the
 * tag on success, or null after printing the error + setting a non-zero exit code.
 */
async function createAndPushTag(root: string, push: boolean): Promise<string | null> {
  const version = await readCurrentVersion(root);
  for (const rel of VERSION_FILES.slice(1)) {
    const file = path.join(root, rel);
    if (!existsSync(file)) continue;
    const v = (JSON.parse(await readFile(file, "utf8")) as { version?: string }).version;
    if (v !== version) {
      ui.error(`${rel} is at ${v}, root at ${version} — lockstep broken; run \`hivelore release bump\` first.`);
      process.exitCode = 1;
      return null;
    }
  }
  const dirty = (await exec("git", ["status", "--porcelain"], { cwd: root })).stdout.trim();
  if (dirty.length > 0) {
    ui.error("Working tree is not clean — commit the bump before tagging.");
    process.exitCode = 1;
    return null;
  }
  const tag = `v${version}`;
  const existing = (await exec("git", ["tag", "--list", tag], { cwd: root })).stdout.trim();
  if (existing) {
    ui.error(`Tag ${tag} already exists — bump the version first.`);
    process.exitCode = 1;
    return null;
  }
  await exec("git", ["tag", tag], { cwd: root });
  ui.success(`Created ${tag} at HEAD.`);
  if (push) {
    // Push the branch and ONLY the new tag — never `--tags` (stale local tags collide upstream).
    await exec("git", ["push"], { cwd: root });
    await exec("git", ["push", "origin", tag], { cwd: root });
    ui.success(`Pushed branch and ${tag}.`);
  }
  return tag;
}

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
      const tag = await createAndPushTag(root, opts.push !== false);
      if (tag && opts.push !== false) {
        ui.info("Next: `hivelore enforce finish --wait` (polls CI), then publish via `pnpm run publish:all` (human step).");
      }
    });

  release
    .command("ship")
    .description("One-shot release close-out: git pull --rebase → tag + push → poll CI (enforce finish --wait). Run it after committing the bump.")
    .option("--no-push", "tag locally without pushing (skips the CI wait)")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: { push?: boolean; dir?: string }) => {
      const root = findProjectRoot(opts.dir);
      const push = opts.push !== false;

      // 1. Sync with the remote first (multi-agent protocol) — abort loudly on a conflict so the human
      //    resolves it rather than tagging a half-merged tree.
      if (push) {
        try {
          await exec("git", ["pull", "--rebase"], { cwd: root });
          ui.success("Rebased on origin.");
        } catch (err) {
          ui.error(`git pull --rebase failed — resolve it, then re-run \`hivelore release ship\`:\n${err instanceof Error ? err.message : String(err)}`);
          process.exitCode = 1;
          return;
        }
      }

      // 2. Tag + push (shared with `release tag`).
      const tag = await createAndPushTag(root, push);
      if (!tag) return; // error already reported
      if (!push) {
        ui.info(`Created ${tag} locally (no push). Run \`hivelore release ship\` without --no-push to publish + poll CI.`);
        return;
      }

      // 3. Poll CI via the real finish gate — no duplicated poll logic; the user sees live progress.
      ui.info("Polling CI (enforce finish --wait)…");
      const code = await new Promise<number>((resolve) => {
        const child = spawn(process.execPath, [process.argv[1]!, "enforce", "finish", "--wait", "--dir", root], {
          stdio: "inherit",
        });
        child.on("close", (c) => resolve(c ?? 1));
        child.on("error", () => resolve(1));
      });
      if (code !== 0) {
        ui.error("Shipped the tag, but the finish gate/CI did not pass — see the output above.");
        process.exitCode = code;
        return;
      }
      ui.success(`Shipped ${tag} — CI green. npm publication stays a human step (\`pnpm run publish:all\`).`);
    });
}
