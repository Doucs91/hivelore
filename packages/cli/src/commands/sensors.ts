import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import {
  findProjectRoot,
  isRetiredMemory,
  loadMemoriesFromDir,
  resolveHaivePaths,
  runSensors,
  sensorTargetsFromDiff,
  type Memory,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

const exec = promisify(execFile);

interface SensorsListOptions {
  json?: boolean;
  dir?: string;
}

interface SensorsCheckOptions {
  diffFile?: string;
  json?: boolean;
  dir?: string;
}

interface SensorsExportOptions {
  format?: "grep" | "eslint";
  outDir?: string;
  dir?: string;
}

export function registerSensors(program: Command): void {
  const sensors = program
    .command("sensors")
    .description("Operate executable sensors derived from hAIve memories");

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
      console.log(ui.bold(`hAIve sensors — ${rows.length}`));
      for (const row of rows) {
        console.log(
          `  • ${row.id} ${ui.dim(`(${row.kind}, ${row.severity})`)} ` +
          `${row.pattern ?? row.command ?? ""}`,
        );
        if (row.paths.length > 0) console.log(`     ${ui.dim("paths:")} ${row.paths.join(", ")}`);
        if (row.last_fired) console.log(`     ${ui.dim("last fired:")} ${row.last_fired}`);
      }
    });

  sensors
    .command("check")
    .description("Run regex sensors against a diff; defaults to `git diff --cached`")
    .option("--diff-file <path>", "read unified diff from a file instead of staged changes")
    .option("--json", "emit JSON", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SensorsCheckOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const memories = await runnableSensorMemories(paths);
      const diff = opts.diffFile
        ? await readFile(path.resolve(root, opts.diffFile), "utf8")
        : await stagedDiff(root);
      const targets = sensorTargetsFromDiff(diff);
      const hits = runSensors(memories, targets.length > 0 ? targets : [{ path: "", content: diff }]);
      const output = {
        scanned: memories.length,
        hits: hits.map((hit) => ({
          memory_id: hit.memory_id,
          file: hit.file,
          severity: hit.severity,
          message: hit.message,
          matched_line: hit.matched_line,
        })),
      };
      if (opts.json) {
        console.log(JSON.stringify(output, null, 2));
      } else {
        console.log(ui.bold(`hAIve sensors check — ${hits.length} hit(s), ${memories.length} sensor(s)`));
        for (const hit of hits) {
          const marker = hit.severity === "block" ? ui.red("✗") : ui.yellow("⚠");
          console.log(`  ${marker} ${hit.memory_id} ${ui.dim(`(${hit.severity})`)}`);
          if (hit.file) console.log(`     ${ui.dim("file:")} ${hit.file}`);
          console.log(`     ${hit.message}`);
          if (hit.matched_line) console.log(`     ${ui.dim(hit.matched_line)}`);
        }
      }
      if (hits.some((hit) => hit.severity === "block")) process.exitCode = 1;
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

async function sensorRows(paths: ReturnType<typeof resolveHaivePaths>) {
  const memories = await runnableSensorMemories(paths, false);
  return memories.map((memory) => {
    const sensor = memory.frontmatter.sensor!;
    return {
      id: memory.frontmatter.id,
      kind: sensor.kind,
      severity: sensor.severity,
      pattern: sensor.pattern,
      command: sensor.command,
      paths: sensor.paths.length > 0 ? sensor.paths : memory.frontmatter.anchor.paths,
      message: sensor.message,
      autogen: sensor.autogen,
      last_fired: sensor.last_fired,
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
      lines.push(`  echo ${shellQuote(`hAIve sensor ${row.id}: ${row.message}`)}`);
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
