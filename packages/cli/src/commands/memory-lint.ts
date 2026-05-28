/**
 * Lightweight quality checks — no ML, safe to run on CI alongside tests.
 */
import { existsSync } from "node:fs";
import { Command } from "commander";
import {
  findProjectRoot,
  getUsage,
  loadMemoriesFromDir,
  loadUsageIndex,
  resolveHaivePaths,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

export type LintSeverity = "error" | "warn" | "info";

export interface MemoryLintFinding {
  file: string;
  id: string;
  severity: LintSeverity;
  code: string;
  message: string;
}

interface LintOpts {
  json?: boolean;
  dir?: string;
}

export async function lintMemoriesAsync(root: string): Promise<MemoryLintFinding[]> {
  const paths = resolveHaivePaths(root);
  const out: MemoryLintFinding[] = [];
  if (!existsSync(paths.memoriesDir)) return out;

  const loaded = await loadMemoriesFromDir(paths.memoriesDir);
  const usage = await loadUsageIndex(paths);

  const ANCHOR_TYPES = new Set(["decision", "architecture", "gotcha"]);
  const actionableWords = /\b(always|never|prefer|use|avoid|because|instead|why|rationale|do not|must|should)\b/i;

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

    if (ANCHOR_TYPES.has(fm.type) && fm.anchor.paths.length === 0 && fm.status === "validated") {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "warn",
        code: "MISSING_ANCHOR",
        message:
          `${fm.type} is validated without anchor paths — add anchor.paths so haive sync can flag staleness.`,
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
    if (fm.status === "validated" && u.read_count === 0) {
      out.push({
        file: filePath,
        id: fm.id,
        severity: "info",
        code: "NEVER_READ",
        message:
          "Validated record has never been surfaced/read. Consider improving tags/anchors or archiving it if it is not useful.",
      });
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

  return out;
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
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: LintOpts) => {
      const root = findProjectRoot(opts.dir);
      const findings = await lintMemoriesAsync(root);

      if (opts.json) {
        console.log(JSON.stringify({ findings_count: findings.length, findings }, null, 2));
        process.exitCode = findings.some((f) => f.severity === "error") ? 1 : 0;
        return;
      }

      if (findings.length === 0) {
        ui.success(`memory lint OK — ${root}`);
        return;
      }

      console.log(ui.bold(`memory lint (${findings.length} finding${findings.length === 1 ? "" : "s"})`) + `\n`);

      const order: Record<LintSeverity, number> = { error: 0, warn: 1, info: 2 };
      findings.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id));

      for (const f of findings) {
        const color =
          f.severity === "error" ? ui.red : f.severity === "warn" ? ui.yellow : ui.dim;
        console.log(
          `${color(f.severity.padEnd(5))} ${ui.dim(f.code)} ${f.id}`,
        );
        console.log(`       ${f.message}`);
        console.log(ui.dim(`       → ${f.file}`));
      }

      process.exitCode = findings.some((x) => x.severity === "error") ? 1 : 0;
    });
}
