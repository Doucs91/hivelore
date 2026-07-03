import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  computeScopeHash,
  sensorAppliesToPath,
  type CommandSensorSpec,
  type Sensor,
  type SensorEvaluation,
  type SensorEvaluationStage,
} from "@hivelore/core";

const exec = promisify(execFile);

export async function gitHeadSha(root: string): Promise<string> {
  try {
    const { stdout } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function trackedFiles(root: string): Promise<string[]> {
  try {
    const { stdout } = await exec("git", ["ls-files", "-co", "--exclude-standard"], { cwd: root });
    return stdout.split("\n").map((f) => f.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function commandScopeHash(root: string, spec: CommandSensorSpec): Promise<string> {
  if (spec.paths.length === 0) return "";
  const sensor = { kind: spec.kind, paths: spec.paths } as Sensor;
  const files = (await trackedFiles(root)).filter((file) => sensorAppliesToPath(sensor, [], file));
  return computeScopeHash(root, files);
}

export function evaluation(
  base: {
    at?: string;
    memory_id: string;
    kind: SensorEvaluation["kind"];
    stage: SensorEvaluationStage;
    head_sha: string;
    scope_hash: string;
    outcome: SensorEvaluation["outcome"];
  },
  command?: { exit_code: number | null; duration_ms: number },
): SensorEvaluation {
  return {
    at: base.at ?? new Date().toISOString(),
    memory_id: base.memory_id,
    kind: base.kind,
    stage: base.stage,
    head_sha: base.head_sha,
    scope_hash: base.scope_hash,
    outcome: base.outcome,
    ...(command?.exit_code !== null ? { exit_code: command?.exit_code } : {}),
    ...(command ? { duration_ms: command.duration_ms } : {}),
  };
}
