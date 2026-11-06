/**
 * `hivelore memory propose` — capture candidates derived from the branch, not from the agent's memory.
 *
 * Reads the commits and the net diff of the current branch (plus this machine's repeated command
 * failures) and lists 0–5 candidates via {@link proposeCaptures}: regression fixes that touch code a
 * decision justified, sensors whose scope missed a bug class the branch fixed, fix commits that
 * explain a cause, retry loops. Each comes with the exact command that records it. `--accept <n>`
 * records the complete ones directly (fix lessons, scope widenings) and stages the file, so the
 * memory ships in the same PR as the fix (field report #9 §7). Nothing is written without --accept.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import {
  buildFrontmatter,
  findProjectRoot,
  loadConfig,
  memoryFilePath,
  parseUnifiedDiff,
  proposeCaptures,
  renderCaptureProposals,
  resolveHaivePaths,
  sanitizeFailureSummary,
  serializeMemory,
  signalFailures,
  type BranchCommit,
  type CaptureProposal,
  type RepeatedFailure,
} from "@hivelore/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { readRecordedCorrections } from "../utils/user-prompt.js";
import { ui } from "../utils/ui.js";

const exec = promisify(execFile);

interface ProposeOptions {
  base?: string;
  accept?: string;
  stage?: boolean;
  json?: boolean;
  dir?: string;
}

async function git(root: string, args: string[]): Promise<string> {
  return (await exec("git", args, { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })).stdout;
}

/** The branch's fork point: merge-base with the upstream release branch, else with the upstream. */
export async function resolveProposalBase(root: string, releaseBranch: string, explicit?: string): Promise<string | null> {
  if (explicit) return explicit;
  for (const ref of [`origin/${releaseBranch}`, releaseBranch, "@{upstream}"]) {
    try {
      const base = (await git(root, ["merge-base", "HEAD", ref])).trim();
      const head = (await git(root, ["rev-parse", "HEAD"])).trim();
      if (base && base !== head) return base;
    } catch { /* ref missing */ }
  }
  return null;
}

export function parseCommitLog(raw: string): BranchCommit[] {
  const commits: BranchCommit[] = [];
  for (const record of raw.split("\x1e")) {
    if (!record.trim()) continue;
    const [sha, subject, body, rest] = record.split("\x1f");
    if (!sha?.trim()) continue;
    commits.push({
      sha: sha.trim(),
      subject: (subject ?? "").trim(),
      body: (body ?? "").trim(),
      files: (rest ?? "").split("\n").map((f) => f.trim()).filter(Boolean),
    });
  }
  return commits;
}

async function repeatedFailures(cacheDir: string): Promise<RepeatedFailure[]> {
  const file = path.join(cacheDir, "observations.jsonl");
  if (!existsSync(file)) return [];
  const since = Date.now() - 24 * 3_600_000;
  const failures: Array<{ ts: string; tool: string; summary: string; files?: string[] }> = [];
  try {
    for (const line of (await readFile(file, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line) as { ts?: string; tool?: string; summary?: string; failure_hint?: boolean; files?: string[] };
        if (o.failure_hint && o.ts && Date.parse(o.ts) >= since) failures.push({ ts: o.ts, tool: o.tool ?? "?", summary: o.summary ?? "", ...(o.files ? { files: o.files } : {}) });
      } catch { /* corrupt line */ }
    }
  } catch {
    return [];
  }
  const groups = new Map<string, RepeatedFailure>();
  for (const f of signalFailures(failures)) {
    const summary = sanitizeFailureSummary(f.summary).slice(0, 160);
    const key = summary.toLowerCase();
    const group = groups.get(key) ?? { summary, count: 0, files: [] };
    group.count++;
    for (const file of f.files ?? []) if (!group.files!.includes(file)) group.files!.push(file);
    groups.set(key, group);
  }
  return [...groups.values()].filter((g) => g.count >= 2);
}

export async function collectCaptureProposals(root: string, base?: string): Promise<{ base: string | null; proposals: CaptureProposal[] }> {
  const paths = resolveHaivePaths(root);
  const config = await loadConfig(paths).catch(() => ({}) as Awaited<ReturnType<typeof loadConfig>>);
  const loaded = existsSync(paths.memoriesDir) ? await loadMemoriesFromDir(paths.memoriesDir) : [];
  const memories = loaded.map((l) => l.memory);
  const resolvedBase = await resolveProposalBase(root, config.enforcement?.releaseBranch ?? "main", base);
  let commits: BranchCommit[] = [];
  let diff: ReturnType<typeof parseUnifiedDiff> = [];
  if (resolvedBase) {
    try {
      commits = parseCommitLog(await git(root, ["log", "--no-merges", "--format=%x1e%H%x1f%s%x1f%b%x1f", "--name-only", `${resolvedBase}..HEAD`]));
      diff = parseUnifiedDiff(await git(root, ["diff", "--unified=0", "--no-color", "--no-ext-diff", `${resolvedBase}...HEAD`]));
    } catch { /* not a git repo / shallow clone: failures-only proposals */ }
  }
  const failures = await repeatedFailures(paths.cacheDir);
  const corrections = await readRecordedCorrections(paths.cacheDir);
  return { base: resolvedBase, proposals: proposeCaptures({ commits, diff, memories, failures, corrections }) };
}

async function acceptProposal(root: string, proposal: CaptureProposal, stage: boolean): Promise<string | null> {
  const paths = resolveHaivePaths(root);
  const config = await loadConfig(paths);
  const loaded = existsSync(paths.memoriesDir) ? await loadMemoriesFromDir(paths.memoriesDir) : [];

  if (proposal.kind === "user-correction" && proposal.rule) {
    const title = proposal.rule.replace(/[.!]+$/, "").slice(0, 80);
    const slug = title.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "developer-rule";
    const frontmatter = buildFrontmatter({
      type: "convention",
      slug,
      scope: "team",
      tags: ["from-correction"],
      status: config.defaultStatus === "validated" ? "validated" : "proposed",
      rule: proposal.rule,
      verifiedBy: `developer correction ${proposal.evidence.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ""}`.trim(),
    });
    if (frontmatter.status === "validated") frontmatter.validated_by = "auto";
    const file = memoryFilePath(paths, "team", frontmatter.id);
    if (existsSync(file)) return null;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, serializeMemory({ frontmatter, body: `# ${title}\n\n${proposal.rule}\n\n_Stated by the developer while correcting an agent._\n` }), "utf8");
    if (stage) await git(root, ["add", "--", path.relative(root, file)]).catch(() => "");
    return path.relative(root, file);
  }

  if (proposal.kind === "fix-lesson" && proposal.rule) {
    const title = proposal.title.replace(/^Gotcha from [0-9a-f]+:\s*/, "");
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "fix-lesson";
    const frontmatter = buildFrontmatter({
      type: "gotcha",
      slug,
      scope: "team",
      paths: proposal.paths,
      tags: ["from-commit"],
      status: config.defaultStatus === "validated" ? "validated" : "proposed",
      evidence: "observed",
      rule: proposal.rule,
      ...(proposal.commit ? { verifiedBy: `fix commit ${proposal.commit.slice(0, 8)}`, commit: proposal.commit } : {}),
    });
    if (frontmatter.status === "validated") frontmatter.validated_by = "auto";
    const body = `# ${title}\n\n${proposal.rule}\n\n_Derived from ${proposal.evidence}_\n`;
    const file = memoryFilePath(paths, "team", frontmatter.id);
    if (existsSync(file)) return null;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");
    if (stage) await git(root, ["add", "--", path.relative(root, file)]).catch(() => "");
    return path.relative(root, file);
  }

  if (proposal.kind === "sensor-scope-gap" && proposal.memory_id) {
    const target = loaded.find((l) => l.memory.frontmatter.id === proposal.memory_id);
    const sensor = target?.memory.frontmatter.sensor;
    const widened = proposal.commands[0]?.match(/--sensor-paths (\S+)/)?.[1];
    if (!target || !sensor || !widened) return null;
    const newFrontmatter = { ...target.memory.frontmatter, sensor: { ...sensor, paths: widened.split(",") } };
    await writeFile(target.filePath, serializeMemory({ frontmatter: newFrontmatter, body: target.memory.body }), "utf8");
    if (stage) await git(root, ["add", "--", path.relative(root, target.filePath)]).catch(() => "");
    return path.relative(root, target.filePath);
  }
  return null;
}

export function registerMemoryPropose(memory: Command): void {
  memory
    .command("propose")
    .description(
      "List memory candidates derived from this branch — regression fixes that touch code a decision justified,\n" +
      "sensors whose scope missed a bug class the branch fixed, fix commits that explain a cause, retry loops.\n" +
      "Each comes with the command that records it; --accept records the complete ones and stages the file.",
    )
    .option("--base <ref>", "compare against this ref instead of the merge-base with the release branch")
    .option("--accept <csv>", "record the listed candidates (1-based) — fix lessons and scope widenings; others print what to fill in")
    .option("--no-stage", "with --accept: write the memory without `git add`")
    .option("--json", "machine-readable output", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: ProposeOptions) => {
      const root = findProjectRoot(opts.dir);
      const { base, proposals } = await collectCaptureProposals(root, opts.base);
      if (opts.json && !opts.accept) {
        console.log(JSON.stringify({ base, proposals }, null, 2));
        return;
      }
      if (!opts.accept) {
        if (!base) ui.info("No branch range found (on the release branch, or no upstream) — pass --base <ref> to review older commits.");
        console.log(renderCaptureProposals(proposals));
        return;
      }
      const picks = opts.accept.split(",").map((n) => Number.parseInt(n.trim(), 10)).filter((n) => Number.isInteger(n));
      const results: Array<{ index: number; written?: string; needs_input?: string[] }> = [];
      for (const index of picks) {
        const proposal = proposals[index - 1];
        if (!proposal) {
          ui.warn(`No candidate #${index}.`);
          continue;
        }
        const written = await acceptProposal(root, proposal, opts.stage !== false);
        if (written) {
          results.push({ index, written });
          if (!opts.json) ui.success(`#${index} recorded → ${written}${opts.stage !== false ? " (staged)" : ""}`);
        } else {
          results.push({ index, needs_input: proposal.commands });
          if (!opts.json) {
            ui.info(`#${index} needs your words — fill in and run:`);
            for (const command of proposal.commands) console.log(`  $ ${command}`);
          }
        }
      }
      if (opts.json) console.log(JSON.stringify({ base, results }, null, 2));
    });
}
