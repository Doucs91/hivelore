/**
 * Lightweight quality checks — no ML, safe to run on CI alongside tests.
 */
import { existsSync } from "node:fs";
import { Command } from "commander";
import {
  findProjectRoot,
  loadMemoriesFromDir,
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

  const ANCHOR_TYPES = new Set(["decision", "architecture", "gotcha"]);

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
  }

  return out;
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
