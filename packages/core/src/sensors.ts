import type { Memory, Sensor } from "./types.js";

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

/**
 * Does this sensor apply to `path`? A sensor with no explicit `paths` (and whose
 * memory has no anchor paths) applies everywhere. Otherwise it applies when the path
 * starts with, or contains, any configured prefix.
 */
export function sensorAppliesToPath(
  sensor: Sensor,
  anchorPaths: string[],
  path: string,
): boolean {
  const scopes = sensor.paths.length > 0 ? sensor.paths : anchorPaths;
  if (scopes.length === 0) return true;
  return scopes.some((p) => path === p || path.startsWith(p) || path.includes(p));
}

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
  for (const rawLine of target.content.split("\n")) {
    // Fresh lastIndex each line (no global flag is forced, but be defensive).
    re.lastIndex = 0;
    if (re.test(rawLine)) {
      return {
        memory_id: memoryId,
        sensor,
        file: target.path,
        matched_line: rawLine.trim().slice(0, 200),
        message: sensor.message,
        severity: sensor.severity,
      };
    }
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
 * Extract the added lines from a unified diff (lines starting with a single `+`,
 * excluding the `+++` file header). Mirrors the diff-handling already used by the
 * anti-pattern tokenizer so sensors fire on introductions, not mere mentions.
 */
export function addedLinesFromDiff(diff: string): string {
  return diff
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1))
    .join("\n");
}
