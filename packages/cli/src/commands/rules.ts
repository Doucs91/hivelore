import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  INSTRUCTION_FILE_CANDIDATES,
  auditInstructionRules,
  buildFrontmatter,
  commandTextForGuards,
  detectAgentContext,
  findProjectRoot,
  globToRegExp,
  isGlobPath,
  loadMemoriesFromDir,
  memoryFilePath,
  planRuleArming,
  renderRulesAudit,
  resolveHaivePaths,
  serializeMemory,
  type ArmPlan,
  type AuditSensor,
  type InstructionFile,
  type Sensor,
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

  rules
    .command("arm")
    .description(
      "Turn the checkable prohibitions found by `rules audit` into checks: a forbidden command becomes a guard\n" +
      "  that denies it before the agent runs it, a protected path a commit-time checklist, a forbidden code\n" +
      "  token a regex sensor. Each plan is validated against the repository first; nothing is written without --apply.",
    )
    .option("-d, --dir <dir>", "project root")
    .option("--apply", "write the memories + sensors (team scope) and stage them", false)
    .option("--only <csv>", "with --apply: arm only these plan numbers")
    .option("--severity <level>", "override severity for code and checklist plans (warn | block); command guards always block")
    .option("--no-stage", "with --apply: do not `git add` the new memories")
    .option("--json", "machine-readable output", false)
    .action(async (opts: { dir?: string; apply?: boolean; only?: string; severity?: string; stage?: boolean; json?: boolean }) => {
      const root = findProjectRoot(opts.dir);
      const audit = auditInstructionRules(await readInstructionFiles(root), await loadAuditSensors(root));
      const { plans, skipped } = planRuleArming(audit.rules);
      const files = trackedFiles(root);
      const validations = plans.map((plan) => validateArmPlan(plan, root, files));
      const skippedRows = skipped.map((s) => ({ text: s.rule.text, where: `${s.rule.file}:${s.rule.line}`, reason: s.reason }));
      if (!opts.apply) {
        if (opts.json) console.log(JSON.stringify({ plans: plans.map((p, i) => ({ ...p, validation: validations[i] })), skipped: skippedRows }, null, 2));
        else console.log(renderPlans(plans, validations, skippedRows));
        return;
      }
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) {
        ui.error("This repository has no .ai/ yet — run `hivelore init` first (or `npx @hivelore/cli init`).");
        process.exitCode = 1;
        return;
      }
      const severityOverride = opts.severity === "block" || opts.severity === "warn" ? opts.severity : undefined;
      const picks = opts.only ? new Set(opts.only.split(",").map((n) => Number.parseInt(n.trim(), 10))) : null;
      const validatedBy = detectAgentContext().agent ? "agent" as const : "human" as const;
      const written: Array<{ plan: number; file: string }> = [];
      for (const [i, plan] of plans.entries()) {
        if (picks && !picks.has(i + 1)) continue;
        if (!validations[i]!.ok) {
          if (!opts.json) ui.warn(`#${i + 1} skipped: ${validations[i]!.note}`);
          continue;
        }
        const severity = plan.kind === "command" ? "block" : severityOverride ?? plan.severity;
        // Arming is an explicit act on a rule the team already wrote down: validated, by whoever ran it.
        const frontmatter = buildFrontmatter({
          type: "convention",
          slug: `rule-${plan.slug}`.slice(0, 60),
          scope: "team",
          tags: ["from-rules"],
          status: "validated",
          rule: plan.statement.slice(0, 400),
          source: `${plan.rule.file}:${plan.rule.line}`,
          sensor: sensorFor(plan, severity),
          ...(plan.kind === "checklist" ? { paths: plan.paths } : {}),
        });
        frontmatter.validated_by = validatedBy;
        const file = memoryFilePath(paths, "team", frontmatter.id);
        if (existsSync(file)) continue;
        await mkdir(path.dirname(file), { recursive: true });
        const body = `# ${plan.statement.slice(0, 100)}\n\n${plan.statement}\n\nFrom \`${plan.rule.file}:${plan.rule.line}\`: ${plan.rule.text.replace(/\*\*/g, "")}\n\nArmed by \`hivelore rules arm\` (${plan.reason}).\n`;
        await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");
        const rel = path.relative(root, file);
        if (opts.stage !== false) {
          try { execFileSync("git", ["add", "--", rel], { cwd: root, stdio: "ignore" }); } catch { /* not a git repo */ }
        }
        written.push({ plan: i + 1, file: rel });
        if (!opts.json) ui.success(`#${i + 1} armed [${plan.kind}/${severity}] → ${rel}`);
      }
      if (opts.json) console.log(JSON.stringify({ written }, null, 2));
      else if (written.length) ui.info("Commit them with the change that motivated them; `hivelore bridges sync` lists block rules in CLAUDE.md/AGENTS.md.");
    });
}

export interface ArmValidation {
  ok: boolean;
  /** One phrase: what was checked and what it found. */
  note: string;
  /** regex: occurrences already in tracked code (sensors only look at added lines). */
  existing?: number;
}

function trackedFiles(root: string): string[] {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })
      .split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/** Check a plan against the repository before anything is written. */
export function validateArmPlan(plan: ArmPlan, root: string, files: string[] = trackedFiles(root)): ArmValidation {
  if (plan.kind === "checklist") {
    const scopes = plan.paths ?? [];
    const hits = files.filter((f) => scopes.some((p) => isGlobPath(p) ? globToRegExp(p).test(f) : f === p || f.startsWith(`${p}/`)));
    return hits.length > 0
      ? { ok: true, note: `protects ${hits.length} tracked file(s)` }
      : { ok: false, note: `no tracked file matches ${scopes.join(", ")} — check the path` };
  }
  let re: RegExp;
  try { re = new RegExp(plan.pattern ?? ""); } catch (err) {
    return { ok: false, note: `invalid pattern: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (plan.kind === "command") {
    if (!re.test(commandTextForGuards(plan.bad_example))) return { ok: false, note: "does not match the command it names" };
    if (re.test(commandTextForGuards(`git commit -m "${plan.bad_example}"`))) return { ok: false, note: "would also block a commit message that merely mentions it" };
    return { ok: true, note: `denies \`${plan.bad_example}\` before it runs; quoted mentions pass` };
  }
  if (!re.test(plan.bad_example)) return { ok: false, note: "does not match the code it names" };
  let existing = 0;
  for (const file of files) {
    if (file.startsWith(".ai/") || /\.(md|mdx|rst|txt|lock|snap|map)$/i.test(file) || /(^|\/)(dist|build|vendor)\//.test(file)) continue;
    try {
      const abs = path.join(root, file);
      if (statSync(abs).size > 512 * 1024) continue;
      const text = readFileSync(abs, "utf8");
      if (text.includes("\0")) continue;
      const global = new RegExp(re.source, "g");
      existing += (text.match(global) ?? []).length;
    } catch { /* unreadable */ }
    if (existing > 999) break;
  }
  return {
    ok: true,
    existing,
    note: existing === 0
      ? "absent from the current code — flags it when a diff adds it"
      : `already ${existing} occurrence(s) in tracked code (not blocked: sensors check added lines) — review them`,
  };
}

function sensorFor(plan: ArmPlan, severity: "warn" | "block"): Sensor {
  const base = { message: plan.message, severity, autogen: false, last_fired: null } as const;
  if (plan.kind === "checklist") return { ...base, kind: "checklist", paths: plan.paths ?? [] };
  return { ...base, kind: plan.kind, pattern: plan.pattern!, paths: [] };
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

function renderPlans(plans: ArmPlan[], validations: ArmValidation[], skipped: Array<{ text: string; where: string; reason: string }>): string {
  const lines: string[] = [];
  if (plans.length === 0) lines.push("Nothing to arm: no checkable prohibition is left unenforced.");
  else lines.push(`${plans.length} rule(s) can become checks:`);
  plans.forEach((plan, i) => {
    const v = validations[i]!;
    lines.push("", `${i + 1}. [${plan.kind}/${plan.severity}] ${plan.rule.text.slice(0, 140)}`);
    lines.push(`   from ${plan.rule.file}:${plan.rule.line} — ${plan.reason}`);
    lines.push(`   ${plan.kind === "checklist" ? `paths: ${(plan.paths ?? []).join(", ")}` : `pattern: ${plan.pattern}`}`);
    lines.push(`   ${v.ok ? "✓" : "✗"} ${v.note}`);
  });
  if (skipped.length) {
    lines.push("", `Not armed (${skipped.length}):`);
    for (const s of skipped.slice(0, 10)) lines.push(`  ${s.where}  ${s.text.slice(0, 90)} — ${s.reason}`);
    if (skipped.length > 10) lines.push(`  …and ${skipped.length - 10} more (--json for all)`);
  }
  if (plans.length) lines.push("", "Arm them: hivelore rules arm --apply [--only 1,3] [--severity block]");
  return lines.join("\n");
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
