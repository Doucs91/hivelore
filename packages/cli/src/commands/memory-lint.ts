/**
 * Lightweight quality checks — no ML, safe to run on CI alongside tests.
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  getUsage,
  loadCodeMap,
  loadMemoriesFromDir,
  loadUsageIndex,
  resolveHaivePaths,
  serializeMemory,
  specificityScore,
  type LoadedMemory,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

export type LintSeverity = "error" | "warn" | "info";

export interface MemoryLintFinding {
  file: string;
  id: string;
  severity: LintSeverity;
  code: string;
  message: string;
  suggested_anchors?: {
    paths: string[];
    symbols: string[];
  };
}

interface LintOpts {
  json?: boolean;
  dir?: string;
  fix?: boolean;
  dryRun?: boolean;
  apply?: boolean;
}

export interface MemoryLintFix {
  file: string;
  id: string;
  actions: string[];
  applied: boolean;
}

export interface MemoryLintReport {
  findings: MemoryLintFinding[];
  fixes: MemoryLintFix[];
}

export async function lintMemoriesAsync(
  root: string,
  options: { fix?: boolean; apply?: boolean } = {},
): Promise<MemoryLintReport> {
  const paths = resolveHaivePaths(root);
  const out: MemoryLintFinding[] = [];
  const fixes: MemoryLintFix[] = [];
  if (!existsSync(paths.memoriesDir)) return { findings: out, fixes };

  const loaded = await loadMemoriesFromDir(paths.memoriesDir);
  const usage = await loadUsageIndex(paths);
  const codeMap = await loadCodeMap(paths);
  const trackedFiles = gitTrackedFiles(root);

  const ANCHOR_TYPES = new Set(["decision", "architecture", "gotcha"]);
  const actionableWords =
    /\b(always|never|prefer|use|run|avoid|because|instead|why|rationale|do not|must|should|require|required|requires|fix|fail|failed|fails|prevent|prevents|allow|allows|lets|ensure|ensures|catch|catches)\b/i;

  for (const { filePath, memory } of loaded) {
    const fm = memory.frontmatter;
    if (fm.type === "session_recap") continue;

    const body = memory.body.trim();
    const naked = body.replace(/^#.*$/gm, "").replace(/```[\s\S]*?```/g, "").trim();

    if (naked.length < 40 && fm.status !== "rejected") {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "warn",
        code: "SHORT_BODY",
        message: "Body looks very short (< ~40 chars of prose after headings). Prefer actionable detail.",
      });
    }

    if (
      ["decision", "gotcha", "convention", "architecture", "attempt"].includes(fm.type) &&
      fm.status !== "rejected" &&
      !actionableWords.test(naked)
    ) {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "info",
        code: "LOW_ACTIONABILITY",
        message:
          "Record does not contain obvious action/rationale words. Add the concrete rule, why it exists, and what to do instead.",
      });
    }

    // Low-value / likely-guessable: hAIve earns its keep on UNGUESSABLE team knowledge. A memory
    // that reads like generic best practice (no concrete literals/identifiers/values) is something
    // a capable model already does by default — surfacing it is mostly token overhead.
    if (
      ["decision", "gotcha", "convention", "architecture"].includes(fm.type) &&
      fm.status !== "rejected" &&
      naked.length >= 40 &&
      specificityScore(naked) < 0.2
    ) {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "info",
        code: "LOW_VALUE_GUESSABLE",
        message:
          "Reads like generic best practice a capable model already follows. hAIve's value is " +
          "UNGUESSABLE team knowledge — add the concrete, arbitrary specifics (exact names, values, " +
          "formats, magic numbers) or consider removing it to keep briefings high-signal.",
      });
    }

    const suggestedAnchors = suggestAnchors(root, { filePath, memory }, codeMap, trackedFiles);
    if (ANCHOR_TYPES.has(fm.type) && fm.anchor.paths.length === 0 && fm.status === "validated") {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "warn",
        code: "MISSING_ANCHOR",
        message:
          `${fm.type} is validated without anchor paths — add anchor.paths so haive sync can flag staleness.`,
        ...(suggestedAnchors.paths.length > 0 || suggestedAnchors.symbols.length > 0
          ? { suggested_anchors: suggestedAnchors }
          : {}),
      });
    }

    if (fm.status === "stale" && !fm.stale_reason) {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "info",
        code: "STALE_NO_REASON",
        message: "Status is stale but stale_reason is empty — document why when possible.",
      });
    }

    if (fm.type === "glossary" && naked.length > 6000) {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "info",
        code: "LONG_GLOSSARY",
        message: "Very long glossary — consider splitting concepts for tighter briefings.",
      });
    }

    const hasMarkdownHeading = /^#{1,3}\s+\S/m.test(memory.body.trim());
    if (!hasMarkdownHeading) {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "warn",
        code: "NO_MD_HEADING",
        message:
          "No Markdown heading (#/##/###) — add one so humans and auditors can skim the memo quickly.",
      });
    }

    const u = getUsage(usage, fm.id);
    const createdAt = Date.parse(fm.created_at);
    const ageDays = Number.isFinite(createdAt)
      ? (Date.now() - createdAt) / (24 * 60 * 60 * 1000)
      : 0;
    if (fm.status === "validated" && u.read_count === 0 && ageDays >= 7) {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "info",
        code: "NEVER_READ",
        message:
          "Validated record has never been surfaced/read. Consider improving tags/anchors or archiving it if it is not useful.",
      });
    }

    if (options.fix) {
      const actions: string[] = [];
      let nextBody = memory.body;
      let nextFrontmatter = memory.frontmatter;

      if (!hasMarkdownHeading) {
        nextBody = `# ${titleFromId(fm.id)}\n\n${nextBody.trim()}`;
        actions.push("add missing Markdown heading");
      }

      if (
        ANCHOR_TYPES.has(fm.type) &&
        fm.anchor.paths.length === 0 &&
        fm.status === "validated" &&
        suggestedAnchors.paths.length > 0
      ) {
        nextFrontmatter = {
          ...nextFrontmatter,
          anchor: {
            ...nextFrontmatter.anchor,
            paths: [...new Set([...nextFrontmatter.anchor.paths, ...suggestedAnchors.paths])],
            symbols: [
              ...new Set([...nextFrontmatter.anchor.symbols, ...suggestedAnchors.symbols]),
            ],
          },
          tags: nextFrontmatter.tags.filter((tag) => tag !== "needs_anchor"),
        };
        actions.push("add suggested tracked anchor paths");
        if (suggestedAnchors.symbols.length > 0) {
          actions.push("add suggested anchor symbols");
        }
      }

      if (
        ANCHOR_TYPES.has(fm.type) &&
        fm.anchor.paths.length === 0 &&
        fm.anchor.symbols.length === 0 &&
        suggestedAnchors.paths.length === 0 &&
        fm.status === "validated" &&
        !fm.tags.includes("needs_anchor")
      ) {
        nextFrontmatter = {
          ...nextFrontmatter,
          tags: [...nextFrontmatter.tags, "needs_anchor"],
        };
        actions.push("tag validated anchorless record with needs_anchor");
      }

      if (actions.length > 0) {
        fixes.push({ file: filePath, id: fm.id, actions, applied: Boolean(options.apply) });
        if (options.apply) {
          await writeFile(
            filePath,
            serializeMemory({ frontmatter: nextFrontmatter, body: nextBody }),
            "utf8",
          );
        }
      }
    }
  }

  for (const dup of nearDuplicatePairs(loaded)) {
    out.push({
      file: dup.file,
      id: dup.id,
      severity: "warn",
      code: "NEAR_DUPLICATE",
      message:
        `Body overlaps ~${Math.round(dup.score * 100)}% with ${dup.otherId}. Merge or deprecate one record to reduce briefing noise.`,
    });
  }

  return { findings: out, fixes };
}

function titleFromId(id: string): string {
  const withoutDate = id.replace(/^\d{4}-\d{2}-\d{2}-/, "");
  return withoutDate
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function suggestAnchors(
  root: string,
  loaded: LoadedMemory,
  codeMap: Awaited<ReturnType<typeof loadCodeMap>>,
  trackedFiles: ReadonlySet<string> | null,
): { paths: string[]; symbols: string[] } {
  const body = loaded.memory.body;
  const paths = new Set<string>();
  const symbols = new Set<string>();

  for (const match of body.matchAll(/`([^`\n]+\.[A-Za-z0-9]+)`|(?:^|\s)([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/gm)) {
    const candidate = (match[1] ?? match[2] ?? "").replace(/^\.?\//, "");
    if (!candidate || candidate.startsWith("http")) continue;
    if (existsSync(path.join(root, candidate)) && isSafeAnchorPath(candidate, trackedFiles)) {
      paths.add(candidate);
    }
  }

  if (codeMap) {
    const lowered = body.toLowerCase();
    for (const [file, entry] of Object.entries(codeMap.files)) {
      for (const exp of entry.exports) {
        if (!exp.name || exp.name.length < 4) continue;
        if (lowered.includes(exp.name.toLowerCase())) {
          if (isSafeAnchorPath(file, trackedFiles)) {
            paths.add(file);
            symbols.add(exp.name);
          }
        }
        if (paths.size >= 5 && symbols.size >= 5) break;
      }
      if (paths.size >= 5 && symbols.size >= 5) break;
    }
  }

  return {
    paths: [...paths].slice(0, 5),
    symbols: [...symbols].slice(0, 5),
  };
}

function gitTrackedFiles(root: string): ReadonlySet<string> | null {
  const result = spawnSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  const files = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return new Set(files);
}

function isSafeAnchorPath(file: string, trackedFiles: ReadonlySet<string> | null): boolean {
  const normalized = file.replace(/\\/g, "/").replace(/^\.?\//, "");
  if (normalized.startsWith(".ai/.cache/") || normalized.startsWith(".ai/.runtime/")) return false;
  if (normalized.includes("/node_modules/") || normalized.startsWith("node_modules/")) return false;
  if (normalized.includes("/dist/") || normalized.startsWith("dist/")) return false;
  if (trackedFiles && !trackedFiles.has(normalized)) return false;
  return true;
}

function nearDuplicatePairs(
  loaded: Awaited<ReturnType<typeof loadMemoriesFromDir>>,
): Array<{ id: string; otherId: string; file: string; score: number }> {
  const out: Array<{ id: string; otherId: string; file: string; score: number }> = [];
  const candidates = loaded.filter(({ memory }) => {
    const fm = memory.frontmatter;
    return fm.type !== "session_recap" && fm.status !== "rejected" && fm.status !== "deprecated";
  });
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      if (a.memory.frontmatter.scope !== b.memory.frontmatter.scope) continue;
      if (a.memory.frontmatter.type !== b.memory.frontmatter.type) continue;
      const score = jaccard(tokenSet(a.memory.body), tokenSet(b.memory.body));
      if (score >= 0.72) {
        out.push({
          id: a.memory.frontmatter.id,
          otherId: b.memory.frontmatter.id,
          file: a.filePath,
          score,
        });
      }
    }
  }
  return out;
}

function tokenSet(body: string): Set<string> {
  return new Set(
    (body.toLowerCase().match(/\b[a-z0-9]{4,}\b/g) ?? [])
      .filter((word) => !["this", "that", "with", "from", "have"].includes(word)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const item of a) if (b.has(item)) inter++;
  return inter / (a.size + b.size - inter);
}

export function registerMemoryLint(parent: Command): void {
  parent
    .command("lint")
    .description(
      "Heuristic corpus checks (anchors on key types, headings, verbosity). Static analysis only.",
    )
    .option("--json", "emit findings as JSON", false)
    .option("--fix", "prepare simple automatic fixes (use with --dry-run or --apply)", false)
    .option("--dry-run", "with --fix, show files that would change without writing", false)
    .option("--apply", "with --fix, write simple fixes to disk", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: LintOpts) => {
      const root = findProjectRoot(opts.dir);
      const apply = Boolean(opts.fix && opts.apply);
      const dryRun = Boolean(opts.fix && (opts.dryRun || !opts.apply));
      const report = await lintMemoriesAsync(root, { fix: Boolean(opts.fix), apply });
      const findings = report.findings;

      if (opts.json) {
        console.log(JSON.stringify({
          findings_count: findings.length,
          findings,
          fixes_count: report.fixes.length,
          fixes: report.fixes,
          fix_mode: opts.fix ? apply ? "apply" : "dry-run" : "off",
        }, null, 2));
        process.exitCode = findings.some((f) => f.severity === "error") ? 1 : 0;
        return;
      }

      if (findings.length === 0) {
        ui.success(`memory lint OK — ${root}`);
        return;
      }

      console.log(ui.bold(`memory lint (${findings.length} finding${findings.length === 1 ? "" : "s"})`) + `\n`);
      if (opts.fix) {
        const mode = apply ? "apply" : dryRun ? "dry-run" : "dry-run";
        const verb = apply ? "changed" : "would change";
        console.log(ui.bold(`fix ${mode}: ${report.fixes.length} file${report.fixes.length === 1 ? "" : "s"} ${verb}`));
        for (const fix of report.fixes) {
          console.log(`  ${ui.dim(fix.id)} ${fix.actions.join("; ")}`);
          console.log(ui.dim(`       → ${fix.file}`));
        }
        console.log();
      }

      const order: Record<LintSeverity, number> = { error: 0, warn: 1, info: 2 };
      findings.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));

      for (const f of findings) {
        const color =
          f.severity === "error" ? ui.red : f.severity === "warn" ? ui.yellow : ui.dim;
        console.log(
          `${color(f.severity.padEnd(5))} ${ui.dim(f.code)} ${f.id}`,
        );
        console.log(`       ${f.message}`);
        if (f.suggested_anchors) {
          const pathHints = f.suggested_anchors.paths.length > 0
            ? `paths: ${f.suggested_anchors.paths.join(", ")}`
            : "";
          const symbolHints = f.suggested_anchors.symbols.length > 0
            ? `symbols: ${f.suggested_anchors.symbols.join(", ")}`
            : "";
          console.log(ui.dim(`       suggested anchors: ${[pathHints, symbolHints].filter(Boolean).join(" · ")}`));
        }
        console.log(ui.dim(`       → ${f.file}`));
      }

      process.exitCode = findings.some((x) => x.severity === "error") ? 1 : 0;
    });
}
