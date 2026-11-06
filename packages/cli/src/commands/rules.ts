import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  INSTRUCTION_FILE_CANDIDATES,
  auditInstructionRules,
  findProjectRoot,
  loadMemoriesFromDir,
  renderRulesAudit,
  resolveHaivePaths,
  type AuditSensor,
  type InstructionFile,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

/**
 * `hivelore rules audit` — how much of what your agents are TOLD is actually ENFORCED?
 *
 * Works on any repository, with or without `hivelore init`: it only reads the agent instruction
 * files and, when a corpus exists, its sensors. Read-only.
 */
export function registerRules(program: Command): void {
  const rules = program
    .command("rules")
    .description("Audit the rules in your agent instruction files (CLAUDE.md, AGENTS.md, .cursor/rules…) against what is enforced.");

  rules
    .command("audit")
    .description(
      "Classify every imperative rule in the agent instruction files as enforced by a gate, mechanically\n" +
      "  checkable but unenforced, or judgment. Read-only; works without `hivelore init`.",
    )
    .option("-d, --dir <dir>", "project root")
    .option("--limit <n>", "checkable rules to list", "20")
    .option("--fail-under <pct>", "exit 1 when enforceable coverage is below this percentage (CI use)")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { dir?: string; limit: string; failUnder?: string; json?: boolean }) => {
      const root = findProjectRoot(opts.dir);
      const files = await readInstructionFiles(root);
      const sensors = await loadAuditSensors(root);
      const audit = auditInstructionRules(files, sensors);
      if (opts.json) console.log(JSON.stringify(audit, null, 2));
      else console.log(renderRulesAudit(audit, { limit: Math.max(1, Number.parseInt(opts.limit, 10) || 20) }));
      if (opts.failUnder !== undefined) {
        const threshold = Number(opts.failUnder) / 100;
        const coverage = audit.enforceable_coverage ?? 1;
        if (Number.isFinite(threshold) && coverage < threshold) {
          if (!opts.json) ui.error(`Enforceable coverage ${Math.round(coverage * 100)}% is below --fail-under ${opts.failUnder}%.`);
          process.exitCode = 1;
        }
      }
    });
}

async function readInstructionFiles(root: string): Promise<InstructionFile[]> {
  const out: InstructionFile[] = [];
  for (const candidate of INSTRUCTION_FILE_CANDIDATES) {
    const abs = path.join(root, candidate);
    if (!existsSync(abs)) continue;
    const info = await stat(abs).catch(() => null);
    if (!info) continue;
    if (info.isFile()) {
      out.push({ path: candidate, content: await readFile(abs, "utf8").catch(() => "") });
    } else if (info.isDirectory()) {
      for (const name of (await readdir(abs).catch(() => [] as string[])).sort()) {
        if (!/\.(md|mdc)$/.test(name)) continue;
        out.push({ path: `${candidate}/${name}`, content: await readFile(path.join(abs, name), "utf8").catch(() => "") });
      }
    }
  }
  return out;
}

async function loadAuditSensors(root: string): Promise<AuditSensor[]> {
  const paths = resolveHaivePaths(root);
  if (!existsSync(paths.memoriesDir)) return [];
  const loaded = await loadMemoriesFromDir(paths.memoriesDir);
  return loaded.flatMap(({ memory }) => {
    const sensor = memory.frontmatter.sensor;
    if (!sensor || ["rejected", "deprecated"].includes(memory.frontmatter.status)) return [];
    return [{ id: memory.frontmatter.id, message: sensor.message, pattern: sensor.pattern, severity: sensor.severity }];
  });
}
