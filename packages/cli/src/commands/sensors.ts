import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import {
  extractSensorExamples,
  appendSensorEvaluations,
  assessSensorHealth,
  sensorPromotedAtMap,
  findProjectRoot,
  isRetiredMemory,
  judgeProposedSensor,
  loadConfig,
  loadSensorLedger,
  loadMemoriesFromDir,
  recordPreventionHits,
  resolveHaivePaths,
  runSensors,
  selectCommandSensors,
  sensorPatternBrittleness,
  sensorSelfCheck,
  sensorAppliesToPath,
  scannableSensorTargets,
  serializeMemory,
  withoutQuarantineNote,
  type CommandSensorSpec,
  type Memory,
  type Sensor,
} from "@hivelore/core";
import { readPresumedCorrectTargets } from "@hivelore/mcp";
import { executeCommandSensors } from "../utils/command-sensors.js";
import { commandScopeHash, evaluation, gitHeadSha } from "../utils/sensor-evaluations.js";
import { ui } from "../utils/ui.js";

const exec = promisify(execFile);

interface SensorsListOptions {
  json?: boolean;
  dir?: string;
}

interface SensorsCheckOptions {
  diffFile?: string;
  json?: boolean;
  commands?: boolean;
  dir?: string;
}

interface SensorsExportOptions {
  format?: "grep" | "eslint";
  outDir?: string;
  dir?: string;
}

interface SensorsPromoteOptions {
  severity?: "warn" | "block";
  yes?: boolean;
  force?: boolean;
  dir?: string;
}

interface SensorsProposeOptions {
  kind?: string;
  command?: string;
  timeout?: string;
  pattern?: string;
  absent?: string;
  badExample?: string;
  severity?: string;
  message?: string;
  flags?: string;
  paths?: string;
  dir?: string;
}

export function registerSensors(program: Command): void {
  const sensors = program
    .command("sensors")
    .description("Operate executable sensors derived from Hivelore memories");

  sensors
    .command("list")
    .description("List memories carrying executable sensors")
    .option("--json", "emit JSON", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SensorsListOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const rows = await sensorRows(paths);
      if (opts.json) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (rows.length === 0) {
        ui.warn("No sensors found.");
        return;
      }
      const brittleCount = rows.filter((r) => "brittle" in r && r.brittle).length;
      console.log(
        ui.bold(`Hivelore sensors — ${rows.length}`) +
          (brittleCount > 0 ? ui.yellow(` (${brittleCount} brittle — see ⚠)`) : ""),
      );
      for (const row of rows) {
        const brittle = "brittle" in row ? row.brittle : undefined;
        console.log(
          `  • ${row.id} ${ui.dim(`(${row.kind}, ${row.severity})`)} ` +
          `${row.pattern ?? row.command ?? ""}`,
        );
        if ("absent" in row && row.absent) console.log(`     ${ui.dim("only when missing:")} ${row.absent}`);
        if (row.paths.length > 0) console.log(`     ${ui.dim("paths:")} ${row.paths.join(", ")}`);
        if (row.last_fired) console.log(`     ${ui.dim("last fired:")} ${row.last_fired}`);
        if (brittle) console.log(`     ${ui.yellow("⚠ brittle:")} ${brittle} — consider rewriting or retiring this sensor`);
      }
    });

  sensors
    .command("check")
    .description(
      "Run regex sensors against a diff (the deterministic/computational layer); defaults to `git diff --cached`.\n" +
      "  Diff-scan layers: `sensors check` (regex) and `anti_patterns_check` (memory match) are components;\n" +
      "  `pre_commit_check` combines them; `hivelore enforce check` is THE gate that runs at commit.",
    )
    .option("--diff-file <path>", "read unified diff from a file instead of staged changes")
    .option("--json", "emit JSON", false)
    .option("--commands", "ALSO execute shell/test sensors (runs repo-authored commands)", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SensorsCheckOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const memories = await runnableSensorMemories(paths);
      const diff = opts.diffFile
        ? await readFile(path.resolve(root, opts.diffFile), "utf8")
        : await stagedDiff(root);
      // Never scan `.ai/` or Hivelore-owned files — a memory body quotes the very pattern it
      // documents and would self-fire (mirrors the git-hook gate in enforce.ts).
      const targets = scannableSensorTargets(diff);
      const hits = runSensors(memories, targets);

      // ── Command (shell/test) sensors — the deterministic check a regex can't express ──
      // OFF by default: they execute arbitrary repo-authored commands. Opt in per-run with
      // `--commands` or per-repo with `enforcement.runCommandSensors: true`.
      const config = await loadConfig(paths);
      const runCommands = opts.commands || config.enforcement?.runCommandSensors === true;
      const changedPaths = targets.map((t) => t.path).filter(Boolean);
      const allSensorMemories = await runnableSensorMemories(paths, false);
      const commandSpecs = selectCommandSensors(allSensorMemories, changedPaths);
      const commandHits: Array<{ memory_id: string; severity: "warn" | "block"; message: string; matched_line: string; output_tail?: string }> = [];
      const commandUnrunnable: Array<{ memory_id: string; reason: string; command: string }> = [];
      const commandSkipped: string[] = [];
      const ledgerRows = [] as import("@hivelore/core").SensorEvaluation[];
      const headSha = await gitHeadSha(root);
      for (const memory of memories) {
        const sensor = memory.frontmatter.sensor;
        if (!sensor || sensor.kind !== "regex") continue;
        const anchors = memory.frontmatter.anchor.paths;
        const applicable = targets.some((target) => sensorAppliesToPath(sensor, anchors, target.path));
        if (!applicable) continue;
        ledgerRows.push(evaluation({
          memory_id: memory.frontmatter.id,
          kind: "regex",
          stage: "manual",
          head_sha: headSha,
          scope_hash: "",
          outcome: hits.some((hit) => hit.memory_id === memory.frontmatter.id) ? "fired" : "silent",
        }));
      }
      if (commandSpecs.length > 0 && runCommands) {
        const runs = await executeCommandSensors(commandSpecs, root);
        for (const run of runs) {
          const spec = commandSpecs.find((candidate) => candidate.memory_id === run.memory_id)!;
          ledgerRows.push(evaluation({
            memory_id: run.memory_id,
            kind: run.kind,
            stage: "manual",
            head_sha: headSha,
            scope_hash: await commandScopeHash(root, spec),
            outcome: run.status === "failed" ? "fired" : run.status === "passed" ? "silent" : "unrunnable",
          }, { exit_code: run.exit_code, duration_ms: run.duration_ms }));
        }
        const prior = await loadSensorLedger(paths);
        const promotedAt = sensorPromotedAtMap(allSensorMemories.map((m) => m.frontmatter));
        const health = new Map(
          assessSensorHealth([...prior, ...ledgerRows], new Date(), { promotedAt }).map((h) => [h.memory_id, h]),
        );
        for (const run of runs) {
          const quarantined = health.get(run.memory_id)?.quarantine_pending === true;
          if (run.status === "failed") {
            commandHits.push({
              memory_id: run.memory_id,
              severity: quarantined ? "warn" : run.severity,
              message: run.message,
              matched_line: `command failed (exit ${run.exit_code}, ${run.duration_ms}ms): ${run.command}`,
              ...(run.output_tail ? { output_tail: run.output_tail } : {}),
            });
          } else if (run.status === "unrunnable") {
            commandUnrunnable.push({ memory_id: run.memory_id, reason: run.unrunnable_reason ?? "unrunnable", command: run.command });
          }
        }
      } else if (commandSpecs.length > 0) {
        for (const spec of commandSpecs) commandSkipped.push(spec.memory_id);
      }
      await appendSensorEvaluations(paths, ledgerRows);

      // Outcome measurement: a sensor firing on a real diff is a *prevention* event — the encoded
      // lesson intercepted a known mistake before it landed. THE shared recorder bumps impact
      // (debounced) and logs the event, identically to the git-hook gate and the MCP anti-pattern gate.
      const firedIds = [...new Set([...hits, ...commandHits].map((hit) => hit.memory_id))];
      const preventionDetails = Object.fromEntries([
        ...hits.map((hit) => [hit.memory_id, { kind: "regex" as const, stage: "manual" as const }]),
        ...commandHits.map((hit) => [hit.memory_id, {
          kind: commandSpecs.find((spec) => spec.memory_id === hit.memory_id)?.kind ?? "shell",
          stage: "manual" as const,
          exit_code: Number(/exit (\d+)/.exec(hit.matched_line)?.[1] ?? 1),
        }]),
      ]);
      await recordPreventionHits(paths, firedIds, "sensor", new Date(), preventionDetails);

      const output = {
        scanned: memories.length,
        hits: hits.map((hit) => ({
          memory_id: hit.memory_id,
          file: hit.file,
          severity: hit.severity,
          message: hit.message,
          matched_line: hit.matched_line,
        })),
        command_hits: commandHits,
        command_unrunnable: commandUnrunnable,
        command_skipped: commandSkipped,
      };
      if (opts.json) {
        console.log(JSON.stringify(output, null, 2));
      } else {
        const total = hits.length + commandHits.length;
        console.log(ui.bold(`Hivelore sensors check — ${total} hit(s), ${memories.length} regex + ${commandSpecs.length} command sensor(s)`));
        for (const hit of hits) {
          const marker = hit.severity === "block" ? ui.red("✗") : ui.yellow("⚠");
          console.log(`  ${marker} ${hit.memory_id} ${ui.dim(`(${hit.severity})`)}`);
          if (hit.file) console.log(`     ${ui.dim("file:")} ${hit.file}`);
          console.log(`     ${hit.message}`);
          if (hit.matched_line) console.log(`     ${ui.dim(hit.matched_line)}`);
        }
        for (const hit of commandHits) {
          const marker = hit.severity === "block" ? ui.red("✗") : ui.yellow("⚠");
          console.log(`  ${marker} ${hit.memory_id} ${ui.dim(`(${hit.severity}, command)`)}`);
          console.log(`     ${hit.message}`);
          console.log(`     ${ui.dim(hit.matched_line)}`);
          if (hit.output_tail) {
            for (const line of hit.output_tail.split("\n").slice(-6)) console.log(`     ${ui.dim("| " + line)}`);
          }
        }
        for (const u of commandUnrunnable) {
          console.log(`  ${ui.yellow("⚠")} ${u.memory_id} ${ui.dim("(unrunnable — never blocks)")}`);
          console.log(`     ${u.reason}: ${ui.dim(u.command)}`);
        }
        if (commandSkipped.length > 0) {
          console.log(ui.dim(`  ${commandSkipped.length} command sensor(s) not run — pass --commands or set enforcement.runCommandSensors.`));
        }
      }
      if ([...hits, ...commandHits].some((hit) => hit.severity === "block")) process.exitCode = 1;
    });

  sensors
    .command("promote")
    .description("Promote or demote an existing memory sensor severity")
    .argument("<memory-id>", "memory id carrying the sensor")
    .option("--severity <severity>", "block | warn", "block")
    .option("--yes", "confirm promotion to block severity", false)
    .option("--force", "promote even a brittle sensor (line-number/literal patterns) to block", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: SensorsPromoteOptions) => {
      const severity = opts.severity ?? "block";
      if (severity !== "block" && severity !== "warn") {
        ui.error("--severity must be block or warn");
        process.exitCode = 1;
        return;
      }
      if (severity === "block" && !opts.yes) {
        ui.error("Promoting a sensor to block makes the gate hard-fail. Re-run with --yes to confirm.");
        process.exitCode = 1;
        return;
      }

      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const loaded = existsSync(paths.memoriesDir) ? await loadMemoriesFromDir(paths.memoriesDir) : [];
      const found = loaded.find(({ memory }) => memory.frontmatter.id === id);
      if (!found) {
        ui.error(`No memory found with id ${id}`);
        process.exitCode = 1;
        return;
      }
      const sensor = found.memory.frontmatter.sensor;
      if (!sensor) {
        ui.error(`Memory ${id} does not carry a sensor.`);
        process.exitCode = 1;
        return;
      }

      // Don't let a brittle pattern become a hard gate — that's how false-positive blocks train
      // agents to ignore the gate (an existential failure mode). Require --force to override.
      const brittle = sensor.kind === "regex" && sensor.pattern ? sensorPatternBrittleness(sensor.pattern) : null;
      if (severity === "block" && brittle && !opts.force) {
        ui.error(`Refusing to block on a brittle sensor (${brittle}). Rewrite the pattern, or pass --force.`);
        process.exitCode = 1;
        return;
      }

      // Self-validation gate: a sensor may only hard-block once it proves it discriminates — it must
      // be SILENT on the current (presumed-correct) code, and ideally FIRE on the lesson's bad example.
      // A sensor that matches correct code is precisely what trains agents to ignore the gate.
      if (severity === "block" && sensor.kind === "regex" && !opts.force) {
        const anchorPaths = sensor.paths.length > 0 ? sensor.paths : found.memory.frontmatter.anchor.paths;
        // HEAD-first: the working tree may still contain the very bad pattern being documented.
        const currentTargets = await readPresumedCorrectTargets(root, anchorPaths);
        const check = sensorSelfCheck(sensor, {
          currentTargets,
          badExamples: extractSensorExamples(found.memory.body),
        });
        if (currentTargets.length > 0 && !check.silent_on_current) {
          ui.error(
            `Refusing to block: this sensor fires on the CURRENT (presumed-correct) code in ` +
              `${check.fired_on.join(", ")} — it would false-positive on every commit. ` +
              `Make it discriminating (add an 'absent' companion), fix the current code, or pass --force.`,
          );
          process.exitCode = 1;
          return;
        }
        if (check.fires_on_bad === true) {
          ui.success("Self-check passed: fires on the lesson's bad example, silent on current code.");
        } else if (check.fires_on_bad === false) {
          ui.warn(
            "Self-check: the sensor did NOT fire on the bad example in the lesson — it may not catch the " +
              "mistake. Promoting anyway (it is at least silent on the current code).",
          );
        } else if (currentTargets.length > 0) {
          ui.info("Self-check: silent on current code (no bad example in the lesson to confirm firing).");
        }
      }

      const next = {
        frontmatter: {
          ...found.memory.frontmatter,
          // promoted_at makes health assessment ignore pre-promotion ledger rows: promoting is the
          // human's assertion the oracle was fixed, so old flaps must not re-quarantine it.
          sensor: severity === "block"
            ? { ...sensor, severity, promoted_at: new Date().toISOString() }
            : { ...sensor, severity },
        },
        body: severity === "block" ? withoutQuarantineNote(found.memory.body) : found.memory.body,
      };
      await writeFile(found.filePath, serializeMemory(next), "utf8");
      ui.success(`Updated ${id}: sensor severity=${severity}`);
      if (sensor.pattern) ui.info(`pattern=${JSON.stringify(sensor.pattern)}`);
      ui.info(`message=${sensor.message}`);
    });

  sensors
    .command("propose")
    .description(
      "Propose a discriminating sensor for a memory — you write the pattern, Hivelore validates it before\n" +
      "  trusting it to block. Mirrors the MCP `propose_sensor` tool (the agent-authored path).\n\n" +
      "  A `block` proposal is accepted ONLY if it is not brittle, stays SILENT on the current code,\n" +
      "  and FIRES on the bad example. Rejected proposals are not written — fix and re-run.\n\n" +
      "  Example:\n" +
      "    hivelore sensors propose <memory-id> \\\n" +
      "      --pattern 'stripe\\.paymentIntents\\.create' --absent 'idempotencyKey' \\\n" +
      "      --bad-example 'stripe.paymentIntents.create({ amount })'",
    )
    .argument("<memory-id>", "memory id to attach the sensor to")
    .option("--kind <kind>", "regex (default) | shell | test — command kinds route the team's own oracle to this lesson", "regex")
    .option("--pattern <regex>", "kind=regex: regex matching the FAULTY usage")
    .option("--command <cmd>", "kind=shell|test: command the gate runs when the diff touches the sensor's paths")
    .option("--timeout <ms>", "kind=shell|test: max runtime in ms (default 120000)")
    .option("--absent <regex>", "regex for the CORRECT-usage marker (makes it discriminate)")
    .option("--bad-example <code>", "a snippet that SHOULD match (else examples are read from the lesson)")
    .option("--severity <severity>", "block | warn", "block")
    .option("--message <text>", "fix message shown when it fires")
    .option("--flags <flags>", "regex flags (e.g. i)")
    .option("--paths <csv>", "override scope paths (defaults to the memory anchors)")
    .option("-d, --dir <dir>", "project root")
    .action(async (id: string, opts: SensorsProposeOptions) => {
      // ── Command sensors (behaviour bridge): delegate to the shared MCP handler, which
      // validates that the oracle PASSES on the current tree before trusting it to block. ──
      if (opts.kind === "shell" || opts.kind === "test") {
        if (!opts.command?.trim()) {
          ui.error("--kind shell|test requires --command.");
          process.exitCode = 1;
          return;
        }
        const root = findProjectRoot(opts.dir);
        const { proposeSensor } = await import("@hivelore/mcp");
        const out = await proposeSensor(
          {
            memory_id: id,
            kind: opts.kind,
            pattern: undefined,
            command: opts.command.trim(),
            timeout_ms: opts.timeout ? Math.max(1, Number(opts.timeout)) : undefined,
            absent: undefined,
            bad_example: undefined,
            severity: (opts.severity === "warn" ? "warn" : "block"),
            message: opts.message,
            flags: undefined,
            paths: opts.paths ? opts.paths.split(",").map((p) => p.trim()).filter(Boolean) : [],
          },
          { paths: resolveHaivePaths(root) },
        );
        if (out.accepted) {
          ui.success(`Command sensor accepted (${out.severity}) on ${id}`);
          ui.info(`  ${out.guidance}`);
        } else {
          ui.error(`Rejected (${out.reason}).`);
          if (out.guidance) ui.warn(`  ${out.guidance}`);
          process.exitCode = 1;
        }
        return;
      }
      if (!opts.pattern?.trim()) {
        ui.error("kind=regex requires --pattern.");
        process.exitCode = 1;
        return;
      }
      const severity = opts.severity === "warn" ? "warn" : "block";
      try { new RegExp(opts.pattern, opts.flags ?? ""); if (opts.absent) new RegExp(opts.absent, opts.flags ?? ""); }
      catch (err) { ui.error(`Invalid regex: ${String(err)}`); process.exitCode = 1; return; }

      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const loaded = existsSync(paths.memoriesDir) ? await loadMemoriesFromDir(paths.memoriesDir) : [];
      const found = loaded.find(({ memory }) => memory.frontmatter.id === id);
      if (!found) { ui.error(`No memory found with id ${id}`); process.exitCode = 1; return; }

      const anchorPaths = opts.paths
        ? opts.paths.split(",").map((s) => s.trim()).filter(Boolean)
        : found.memory.frontmatter.anchor.paths;
      // HEAD-first: the working tree may still contain the very bad pattern being documented.
      const currentTargets = await readPresumedCorrectTargets(root, anchorPaths);
      const badExamples = [
        ...(opts.badExample ? [opts.badExample] : []),
        ...extractSensorExamples(found.memory.body),
      ];

      const sensor: Sensor = {
        kind: "regex",
        pattern: opts.pattern,
        ...(opts.absent ? { absent: opts.absent } : {}),
        ...(opts.flags ? { flags: opts.flags } : {}),
        paths: anchorPaths,
        message: opts.message?.trim() || deriveProposedMessage(found.memory.body, opts.pattern, opts.absent),
        severity,
        autogen: false,
        last_fired: null,
      };

      const verdict = judgeProposedSensor(sensor, { currentTargets, badExamples });
      if (!verdict.accepted) {
        ui.error(`Rejected (${verdict.reason}).`);
        if (verdict.reason === "fires-on-current") {
          ui.warn(`Fires on the CURRENT correct code in: ${verdict.self_check.fired_on.join(", ")}. Add/tighten --absent, then re-run.`);
        } else if (verdict.reason === "missed-bad-example") {
          ui.warn("Did not match the bad example — the pattern won't catch the mistake. Adjust --pattern, then re-run.");
        } else if (verdict.reason === "brittle") {
          ui.warn(`Pattern is brittle (${verdict.brittle}). Use a durable pattern, then re-run.`);
        }
        process.exitCode = 1;
        return;
      }

      await writeFile(found.filePath, serializeMemory({ frontmatter: { ...found.memory.frontmatter, sensor }, body: found.memory.body }), "utf8");
      ui.success(`Sensor accepted (${severity}) on ${id}`);
      ui.info(`pattern=${JSON.stringify(opts.pattern)}${opts.absent ? `  absent=${JSON.stringify(opts.absent)}` : ""}`);
      ui.info(
        `self-check: silent on current=${verdict.self_check.silent_on_current}` +
        (verdict.self_check.fires_on_bad === null ? "; no bad example tested" : `; fires on bad=${verdict.self_check.fires_on_bad}`),
      );
    });

  sensors
    .command("export")
    .description("Export regex sensors into .ai/generated for external toolchains")
    .option("--format <format>", "grep | eslint", "grep")
    .option("--out-dir <dir>", "output directory", ".ai/generated")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SensorsExportOptions) => {
      const format = opts.format ?? "grep";
      if (format !== "grep" && format !== "eslint") {
        ui.error("--format must be grep or eslint");
        process.exitCode = 1;
        return;
      }
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const rows = await sensorRows(paths);
      const outDir = path.resolve(root, opts.outDir ?? ".ai/generated");
      await mkdir(outDir, { recursive: true });
      const outPath = path.join(outDir, format === "grep" ? "haive-sensors-grep.sh" : "haive-sensors-eslint.json");
      const content = format === "grep" ? renderGrepScript(rows) : JSON.stringify({ sensors: rows }, null, 2) + "\n";
      await writeFile(outPath, content, "utf8");
      if (format === "grep") await chmod(outPath, 0o755);
      ui.success(`Exported ${rows.length} sensor(s): ${path.relative(root, outPath)}`);
    });
}

/** Default sensor message for a CLI-proposed sensor when --message is omitted. */
function deriveProposedMessage(body: string, pattern: string, absent?: string): string {
  const instead = body.match(/\*\*Instead,\s*use:\*\*\s*([^\n]+)/i)?.[1]?.trim();
  if (absent) {
    const base = `${pattern} without ${absent}`;
    return instead ? `${base} — ${instead}` : `${base} — add the required companion.`;
  }
  const heading = body
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0 && !l.startsWith("---"));
  return heading?.slice(0, 180) || `Avoid ${pattern}.`;
}

async function sensorRows(paths: ReturnType<typeof resolveHaivePaths>) {
  const memories = await runnableSensorMemories(paths, false);
  return memories.map((memory) => {
    const sensor = memory.frontmatter.sensor!;
    const brittle = sensor.kind === "regex" && sensor.pattern ? sensorPatternBrittleness(sensor.pattern) : null;
    return {
      id: memory.frontmatter.id,
      kind: sensor.kind,
      severity: sensor.severity,
      pattern: sensor.pattern,
      absent: sensor.absent,
      command: sensor.command,
      paths: sensor.paths.length > 0 ? sensor.paths : memory.frontmatter.anchor.paths,
      message: sensor.message,
      autogen: sensor.autogen,
      last_fired: sensor.last_fired,
      ...(brittle ? { brittle } : {}),
    };
  });
}

async function runnableSensorMemories(
  paths: ReturnType<typeof resolveHaivePaths>,
  regexOnly = true,
): Promise<Memory[]> {
  if (!existsSync(paths.memoriesDir)) return [];
  const loaded = await loadMemoriesFromDir(paths.memoriesDir);
  return loaded
    .map(({ memory }) => memory)
    .filter((memory) => {
      const sensor = memory.frontmatter.sensor;
      if (!sensor) return false;
      if (regexOnly && sensor.kind !== "regex") return false;
      return !isRetiredMemory(memory.frontmatter, memory.body);
    });
}

/**
 * Run one shell/test sensor command. Returns true when the command FAILS (non-zero exit) — that is
 * the "the bad state is present" signal. A timeout or spawn error counts as a failure too (the check
 * couldn't confirm the good state). Never throws.
 */

async function stagedDiff(root: string): Promise<string> {
  try {
    const { stdout } = await exec("git", ["diff", "--cached"], { cwd: root });
    return stdout;
  } catch (err) {
    throw new Error(`git diff --cached failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function renderGrepScript(rows: Awaited<ReturnType<typeof sensorRows>>): string {
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "status=0",
    "",
  ];
  for (const row of rows.filter((item) => item.kind === "regex" && item.pattern)) {
    const paths = row.paths.length > 0 ? row.paths : ["."];
    for (const p of paths) {
      lines.push(`if grep -RInE -- ${shellQuote(row.pattern!)} ${shellQuote(p)}; then`);
      lines.push(`  echo ${shellQuote(`Hivelore sensor ${row.id}: ${row.message}`)}`);
      if (row.severity === "block") lines.push("  status=1");
      lines.push("fi");
      lines.push("");
    }
  }
  lines.push("exit $status", "");
  return lines.join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
