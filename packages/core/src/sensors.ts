import type { Memory, Sensor } from "./types.js";
import { BRIDGE_TARGET_PATH } from "./bridges.js";
import { globToRegExp, isGlobPath } from "./relevance.js";

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
 * memory has no anchor paths) applies everywhere. Otherwise it applies to the exact
 * file, a directory prefix, or a glob (`**` / `*.controller.ts` style) scope.
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
    // Glob scopes (stack packs ship `**/*.controller.ts`-style sensors) were silently dead
    // under pure prefix matching — every glob-scoped sensor never fired anywhere.
    if (isGlobPath(scope)) return globToRegExp(scope).test(target);
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
  /** Optional incident provenance carried from the sensor (ticket/prod ref this test guards). */
  incident?: string;
  /** Anchor/scoped paths this sensor cares about (for reporting). */
  paths: string[];
  /** Max runtime in ms (executor default applies when unset). */
  timeout_ms?: number;
}

/**
 * Render the incident-provenance suffix appended to a fired sensor's message. Empty when the sensor
 * carries no `incident` — so the behaviour-harness link ("guards the incident this test exists for")
 * shows up wherever a sensor speaks, without every call site re-deriving the copy.
 */
export function incidentSuffix(incident?: string): string {
  const ref = incident?.trim();
  return ref ? `  ↩ guards incident: ${ref}` : "";
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
      ...(sensor.incident ? { incident: sensor.incident } : {}),
      paths: sensor.paths.length > 0 ? sensor.paths : anchorPaths,
      ...(sensor.timeout_ms ? { timeout_ms: sensor.timeout_ms } : {}),
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
 * Files Hivelore itself owns/generates — scanning them with sensors self-matches the very memories
 * they mirror (a memory body documenting a bad pattern literally contains that pattern, and a
 * generated bridge re-states the block sensors). Mirrors `isHaiveOwnedPath` in the MCP
 * anti-pattern check; centralized here so the git-hook gate (`enforce check`) and the standalone
 * `sensors check` CLI can never drift apart on what counts as scannable code.
 */
export const HAIVE_OWNED_FILES: ReadonlySet<string> = new Set<string>([
  ...Object.values(BRIDGE_TARGET_PATH),
  "CLAUDE.md",
  ".cursorrules",
  ".gitignore",
  ".mcp.json",
  ".cursor/mcp.json",
  ".vscode/mcp.json",
  ".cursor/rules/haive-mcp-required.mdc",
]);

/**
 * A diff target is scannable by sensors only when it is real source — never the `.ai/` knowledge
 * base or a Hivelore-generated bridge/config file. Without this guard, staging an `.ai/memories/*.md`
 * file (whose body quotes the bad pattern) makes the sensor fire on itself — a false positive.
 */
export function isSensorScannablePath(p: string): boolean {
  if (!p) return false;
  if (p.startsWith(".ai/")) return false;
  return !HAIVE_OWNED_FILES.has(p);
}

/**
 * Filter raw diff targets down to scannable source files. Falls back to scanning the whole diff as
 * one anonymous blob ONLY when the diff carried no file headers at all (e.g. a hand-fed `--diff-file`
 * with bare content) — never when every header was a Hivelore-owned path, so `.ai/`-only diffs scan nothing.
 */
export function scannableSensorTargets(diff: string): SensorTarget[] {
  const all = sensorTargetsFromDiff(diff);
  if (all.length === 0) return [{ path: "", content: diff }];
  return all.filter((t) => isSensorScannablePath(t.path));
}

// ── Self-validation: a generated sensor must prove it discriminates before it can block ──────────

export interface SensorSelfCheck {
  /** The sensor stays SILENT on the current, presumed-correct code — i.e. it won't false-positive. */
  silent_on_current: boolean;
  /** Did it fire on a known-bad example from the lesson? null when no example was available. */
  fires_on_bad: boolean | null;
  /** Files whose CURRENT content the sensor matched — evidence of a false positive. */
  fired_on: string[];
  /**
   * Safe to hard-block: silent on the current code AND (fires on the bad example, or there was no
   * example to test). A sensor that fires on correct code is exactly what trains agents to ignore the
   * gate — this is the gate that keeps the auto-generation layer honest.
   */
  passed: boolean;
}

/**
 * Validate a sensor before it is trusted to hard-block. Pure: the caller supplies the CURRENT
 * (presumed-correct) file contents and any bad examples lifted from the lesson body.
 *
 *   - silent_on_current: the sensor must NOT match the current code (else it false-positives).
 *   - fires_on_bad: if the lesson carried a bad code example, the sensor SHOULD match it.
 */
export function sensorSelfCheck(
  sensor: Sensor,
  input: { currentTargets: SensorTarget[]; badExamples: string[] },
): SensorSelfCheck {
  const firedOn: string[] = [];
  for (const target of input.currentTargets) {
    if (runRegexSensor("self-check", sensor, target)) firedOn.push(target.path);
  }
  const silentOnCurrent = firedOn.length === 0;

  let firesOnBad: boolean | null = null;
  if (input.badExamples.length > 0) {
    firesOnBad = input.badExamples.some(
      (example) => runRegexSensor("self-check", sensor, { path: "<example>", content: example }) !== null,
    );
  }

  return {
    silent_on_current: silentOnCurrent,
    fires_on_bad: firesOnBad,
    fired_on: firedOn,
    passed: silentOnCurrent && firesOnBad !== false,
  };
}

export interface ProposedSensorVerdict {
  /** Safe to store at the requested severity. */
  accepted: boolean;
  /** Why a block proposal was rejected (so the agent can revise and re-propose). */
  reason?: "fires-on-current" | "missed-bad-example" | "brittle";
  self_check: SensorSelfCheck;
  /** Brittleness reason (hardcoded line numbers, etc.) or null. */
  brittle: string | null;
}

/**
 * Decide whether a PROPOSED sensor may be trusted at its severity. This is the deterministic gate
 * behind "the agent (LLM) proposes the sensor, core validates it": a `block` sensor is accepted only
 * if it is NOT brittle, stays SILENT on the current (presumed-correct) code, and FIRES on the bad
 * example (when one is available). A `warn` sensor is always accepted (advisory). Pure.
 */
export function judgeProposedSensor(
  sensor: Sensor,
  input: { currentTargets: SensorTarget[]; badExamples: string[] },
): ProposedSensorVerdict {
  const brittle = sensor.kind === "regex" && sensor.pattern ? sensorPatternBrittleness(sensor.pattern) : null;
  const self_check = sensorSelfCheck(sensor, input);
  if (sensor.severity === "block") {
    if (brittle) return { accepted: false, reason: "brittle", self_check, brittle };
    if (input.currentTargets.length > 0 && !self_check.silent_on_current) {
      return { accepted: false, reason: "fires-on-current", self_check, brittle };
    }
    if (self_check.fires_on_bad === false) {
      return { accepted: false, reason: "missed-bad-example", self_check, brittle };
    }
  }
  return { accepted: true, self_check, brittle };
}

/**
 * Pull candidate bad-code examples from a lesson body: fenced code blocks and inline code spans that
 * look like code (contain a call/dot/assignment). Used to confirm a generated sensor actually fires
 * on the mistake it describes.
 */
export function extractSensorExamples(body: string): string[] {
  const examples: string[] = [];
  for (const match of body.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    const code = (match[1] ?? "").trim();
    if (code) examples.push(code);
  }
  for (const match of body.matchAll(/`([^`\n]{3,200})`/g)) {
    const span = (match[1] ?? "").trim();
    if (span && /[().=]/.test(span)) examples.push(span);
  }
  return examples;
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
