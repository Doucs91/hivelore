/**
 * Shared executor for `kind: "shell" | "test"` sensors — the behaviour bridge.
 *
 * A command sensor routes the TEAM'S OWN ORACLE (an existing test, an invariant script)
 * to the lesson it protects: when a diff touches the sensor's paths, the gate runs the
 * command and a non-zero exit refuses the commit with the lesson as the message.
 *
 * Two failure classes are deliberately distinct:
 *   - "failed"     → the command ran and exited non-zero: the ORACLE spoke. Enforced at the
 *                    sensor's severity (block → gate error).
 *   - "unrunnable" → the command itself could not run (not found: 126/127, or timeout): the
 *                    oracle said NOTHING about the code. Surfaced as a warning, never a block —
 *                    a broken harness must not masquerade as a failing test.
 *
 * Security posture: these execute repo-authored commands, so they are opt-in per repo
 * (`enforcement.runCommandSensors: true`) or per run (`sensors check --commands`) — never
 * enabled globally by Hivelore itself.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CommandSensorSpec } from "@hivelore/core";

const exec = promisify(execFile);

export const COMMAND_SENSOR_DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_TAIL_LINES = 15;

export interface CommandSensorRun {
  memory_id: string;
  command: string;
  kind: "shell" | "test";
  severity: "warn" | "block";
  message: string;
  /** Incident provenance carried from the sensor spec (for the block message + receipt). */
  incident?: string;
  status: "passed" | "failed" | "unrunnable";
  exit_code: number | null;
  /** Last lines of stdout+stderr — enough to see WHICH assertion failed without re-running. */
  output_tail: string;
  duration_ms: number;
  /** Why the command was unrunnable (timeout, not found) when status is "unrunnable". */
  unrunnable_reason?: string;
}

function tail(text: string): string {
  const lines = text.split("\n").map((l) => l.trimEnd()).filter((l) => l.length > 0);
  return lines.slice(-OUTPUT_TAIL_LINES).join("\n").slice(0, 2000);
}

export async function executeCommandSensor(
  spec: CommandSensorSpec,
  root: string,
): Promise<CommandSensorRun> {
  const timeoutMs = spec.timeout_ms ?? COMMAND_SENSOR_DEFAULT_TIMEOUT_MS;
  const started = Date.now();
  const base = {
    memory_id: spec.memory_id,
    command: spec.command,
    kind: spec.kind,
    severity: spec.severity,
    message: spec.message,
    ...(spec.incident ? { incident: spec.incident } : {}),
  };
  try {
    const { stdout, stderr } = await exec("bash", ["-c", spec.command], {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, HIVELORE_SENSOR: spec.memory_id },
    });
    return {
      ...base,
      status: "passed",
      exit_code: 0,
      output_tail: tail(`${stdout}\n${stderr}`),
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    const e = err as NodeJS.ErrnoException & {
      code?: number | string;
      killed?: boolean;
      signal?: string;
      stdout?: string;
      stderr?: string;
    };
    const duration = Date.now() - started;
    const output = tail(`${e.stdout ?? ""}\n${e.stderr ?? ""}\n${e.message ?? ""}`);
    if (e.killed || e.signal === "SIGTERM") {
      return {
        ...base,
        status: "unrunnable",
        exit_code: null,
        output_tail: output,
        duration_ms: duration,
        unrunnable_reason: `timed out after ${timeoutMs}ms — raise sensor.timeout_ms or make the check narrower`,
      };
    }
    const exitCode = typeof e.code === "number" ? e.code : null;
    // bash exit conventions: 127 = command not found, 126 = found but not executable.
    if (exitCode === 127 || exitCode === 126 || e.code === "ENOENT") {
      return {
        ...base,
        status: "unrunnable",
        exit_code: exitCode,
        output_tail: output,
        duration_ms: duration,
        unrunnable_reason: exitCode === 126 ? "command found but not executable" : "command not found",
      };
    }
    return {
      ...base,
      status: "failed",
      exit_code: exitCode,
      output_tail: output,
      duration_ms: duration,
    };
  }
}

/** Run specs sequentially (they may share ports/DBs; parallel test runners self-parallelize). */
export async function executeCommandSensors(
  specs: CommandSensorSpec[],
  root: string,
): Promise<CommandSensorRun[]> {
  const runs: CommandSensorRun[] = [];
  for (const spec of specs) runs.push(await executeCommandSensor(spec, root));
  return runs;
}
