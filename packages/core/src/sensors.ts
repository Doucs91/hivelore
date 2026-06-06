import type { Memory, Sensor } from "./types.js";

/**
 * Is a regex sensor pattern brittle — over-fit to incident-specific literals that rot when code
 * shifts (hardcoded line numbers / ranges like `1131-1186`)? High-precision by design: digits that
 * live inside a character class (`[0-9]`) or quantifier (`{2,}`) generalize and are NOT flagged, so
 * durable patterns like `v[0-9]+\.[0-9]+` or `:\s*any\b` stay clean. Returns a short reason or null.
 *
 * Used to keep brittle legacy sensors from being counted as real protection or promoted to `block`.
 */
export function sensorPatternBrittleness(pattern: string): string | null {
  const literal = pattern.replace(/\[[^\]]*\]/g, "").replace(/\{[^}]*\}/g, "");
  if (/\d{2,}\s*-\s*\d{2,}/.test(literal)) return "hardcoded line/number range — rots when code shifts";
  if (/\d{3,}/.test(literal)) return "hardcoded numeric literal (likely a line number) — rots when code shifts";
  return null;
}

/**
 * Sensors — the feedback *computational* layer of the harness.
 *
 * A memory's `sensor` turns a documented lesson (gotcha/attempt) into a deterministic
 * check. Unlike semantic anti-pattern matching (probabilistic, warmup-sensitive), a
 * regex sensor fires the same way every time, so a known mistake becomes a permanent
 * guardrail. Phase 1 supports `kind: "regex"` only — pure, no I/O. `shell`/`test`
 * sensors are recognized but not executed here (they must run from the CLI).
 */

export interface SensorHit {
  /** The memory id whose sensor matched. */
  memory_id: string;
  /** The sensor that matched. */
  sensor: Sensor;
  /** Project-relative file the match was found in (when known). */
  file?: string;
  /** The matched line (trimmed, capped) — useful for review output. */
  matched_line?: string;
  /** LLM-facing self-correction message carried from the sensor. */
  message: string;
  severity: Sensor["severity"];
}

/** A unit of code to scan: a file path plus the text to match against. */
export interface SensorTarget {
  /** Project-relative path (used for path scoping and reporting). */
  path: string;
  /**
   * Text to scan. For a diff, pass only the added lines (callers should pre-filter)
   * so a sensor fires on "you introduced the bad pattern", not "you touched a file
   * that merely mentions it".
   */
  content: string;
}

function normalizeProjectPath(value: string): string {
  return value
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^[ab]\//, "")
    .replace(/\/+$/g, "");
}

/**
 * Does this sensor apply to `path`? A sensor with no explicit `paths` (and whose
 * memory has no anchor paths) applies everywhere. Otherwise it applies only to the
 * exact file or directory prefix. Use an explicit directory path (`src/foo/`) when a
 * sensor should cover a whole subtree.
 */
export function sensorAppliesToPath(
  sensor: Sensor,
  anchorPaths: string[],
  path: string,
): boolean {
  const scopes = sensor.paths.length > 0 ? sensor.paths : anchorPaths;
  if (scopes.length === 0) return true;
  const target = normalizeProjectPath(path);
  return scopes.some((rawScope) => {
    const scope = normalizeProjectPath(rawScope);
    if (!scope) return false;
    return target === scope || target.startsWith(`${scope}/`);
  });
}

/**
 * Window (in added lines) searched for the `absent` (correct-usage) marker around a trigger match.
 *
 * FORWARD-biased on purpose: a risky call's required companion (e.g. an option object) is part of the
 * call's ARGUMENTS, which follow the call across the next few lines — so we look mostly ahead.
 * The lookback is tiny (catches an options-object hoisted to the line just above) but small enough
 * that a *separate* correct call sitting above a faulty one does NOT mask the faulty one (the live
 * failure that a symmetric window caused). Asymmetry > a single big symmetric window.
 */
export const SENSOR_ABSENT_WINDOW = 6;
export const SENSOR_ABSENT_LOOKBACK = 2;

/**
 * Compile a regex sensor. Returns null when the sensor is not a runnable regex
 * (wrong kind, missing/invalid pattern) so callers can skip it safely.
 */
export function compileRegexSensor(sensor: Sensor): RegExp | null {
  if (sensor.kind !== "regex" || !sensor.pattern) return null;
  try {
    // Always multiline so `^`/`$` work per added line; merge with caller flags.
    const flags = new Set(["m", ...(sensor.flags ?? "").split("")].filter(Boolean));
    return new RegExp(sensor.pattern, [...flags].join(""));
  } catch {
    return null;
  }
}

/** Compile the optional `absent` (correct-usage) regex for a discriminating sensor, or null. */
function compileAbsentRegex(sensor: Sensor): RegExp | null {
  if (sensor.kind !== "regex" || !sensor.absent) return null;
  try {
    const flags = new Set(["m", ...(sensor.flags ?? "").split("")].filter(Boolean));
    return new RegExp(sensor.absent, [...flags].join(""));
  } catch {
    return null;
  }
}

/**
 * Run a single regex sensor over one target. Returns the first matching line as a hit,
 * or null. Deterministic and side-effect-free.
 */
export function runRegexSensor(
  memoryId: string,
  sensor: Sensor,
  target: SensorTarget,
): SensorHit | null {
  const re = compileRegexSensor(sensor);
  if (!re) return null;
  const absentRe = compileAbsentRegex(sensor);
  const lines = target.content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i]!;
    // Fresh lastIndex each line (no global flag is forced, but be defensive).
    re.lastIndex = 0;
    if (!re.test(rawLine)) continue;

    // Discriminating sensor: the trigger matched, but if the correct-usage marker (`absent`) is
    // present within the window around this match, this is a LEGITIMATE use — skip it and keep
    // scanning for a genuinely faulty occurrence. This is what turns "fires on every call" into
    // "fires only on the faulty call".
    if (absentRe) {
      const from = Math.max(0, i - SENSOR_ABSENT_LOOKBACK);
      const to = Math.min(lines.length, i + SENSOR_ABSENT_WINDOW + 1);
      absentRe.lastIndex = 0;
      if (absentRe.test(lines.slice(from, to).join("\n"))) continue;
    }

    // A brittle pattern (hardcoded line numbers, etc.) must never hard-block, even if a human
    // promoted it to `block` — a fragile false-positive gate is what trains agents to ignore the
    // gate entirely. Downgrade to warn at match time so it stays advisory everywhere.
    const brittle = sensor.kind === "regex" && sensor.pattern ? sensorPatternBrittleness(sensor.pattern) : null;
    const severity = brittle ? "warn" : sensor.severity;
    return {
      memory_id: memoryId,
      sensor,
      file: target.path,
      matched_line: rawLine.trim().slice(0, 200),
      message: sensor.message,
      severity,
    };
  }
  return null;
}

/**
 * Run every memory's regex sensor against every applicable target.
 *
 * Memories without a sensor, or with a non-regex sensor, are skipped (non-regex kinds
 * are the CLI's responsibility). At most one hit per (memory, file) pair is returned.
 */
export function runSensors(
  memories: Memory[],
  targets: SensorTarget[],
): SensorHit[] {
  const hits: SensorHit[] = [];
  for (const memory of memories) {
    const sensor = memory.frontmatter.sensor;
    if (!sensor || sensor.kind !== "regex") continue;
    const anchorPaths = memory.frontmatter.anchor.paths;
    for (const target of targets) {
      if (!sensorAppliesToPath(sensor, anchorPaths, target.path)) continue;
      const hit = runRegexSensor(memory.frontmatter.id, sensor, target);
      if (hit) hits.push(hit);
    }
  }
  return hits;
}

/**
 * A shell/test sensor selected for execution — the feedback *computational* layer that a regex
 * can't express. The schema reserves `kind: "shell" | "test"`; this picks the ones whose memory
 * applies to the changed paths so the CLI can run `command` (core stays pure — it never executes).
 */
export interface CommandSensorSpec {
  memory_id: string;
  /** Command to execute (shell or test runner invocation). */
  command: string;
  kind: "shell" | "test";
  severity: Sensor["severity"];
  /** LLM-facing self-correction message carried from the sensor. */
  message: string;
  /** Anchor/scoped paths this sensor cares about (for reporting). */
  paths: string[];
}

/**
 * Select the shell/test sensors that apply to `changedPaths`. With no changed paths (or a sensor
 * scoped to everywhere) the sensor is selected unconditionally. Pure: the caller executes commands.
 */
export function selectCommandSensors(
  memories: Memory[],
  changedPaths: string[],
): CommandSensorSpec[] {
  const specs: CommandSensorSpec[] = [];
  for (const memory of memories) {
    const sensor = memory.frontmatter.sensor;
    if (!sensor) continue;
    if (sensor.kind !== "shell" && sensor.kind !== "test") continue;
    const command = sensor.command?.trim();
    if (!command) continue;
    const anchorPaths = memory.frontmatter.anchor.paths;
    const applies =
      changedPaths.length === 0
        ? true
        : changedPaths.some((p) => sensorAppliesToPath(sensor, anchorPaths, p));
    if (!applies) continue;
    specs.push({
      memory_id: memory.frontmatter.id,
      command,
      kind: sensor.kind,
      severity: sensor.severity,
      message: sensor.message,
      paths: sensor.paths.length > 0 ? sensor.paths : anchorPaths,
    });
  }
  return specs;
}

/** Split a unified diff into per-file targets containing only added lines. */
export function sensorTargetsFromDiff(diff: string): SensorTarget[] {
  const targets: SensorTarget[] = [];
  let currentPath: string | null = null;
  let added: string[] = [];

  const flush = (): void => {
    if (!currentPath || added.length === 0) return;
    targets.push({ path: currentPath, content: added.join("\n") });
    added = [];
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      currentPath = null;
      continue;
    }

    if (line.startsWith("+++ ")) {
      flush();
      const raw = line.slice(4).trim();
      currentPath = raw === "/dev/null" ? null : normalizeProjectPath(raw);
      continue;
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      if (!currentPath) currentPath = "";
      added.push(line.slice(1));
    }
  }
  flush();
  return targets;
}

/**
 * Extract the added lines from a unified diff (lines starting with a single `+`,
 * excluding the `+++` file header). Mirrors the diff-handling already used by the
 * anti-pattern tokenizer so sensors fire on introductions, not mere mentions.
 */
export function addedLinesFromDiff(diff: string): string {
  const targets = sensorTargetsFromDiff(diff);
  if (targets.length > 0) return targets.map((target) => target.content).join("\n");
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}
