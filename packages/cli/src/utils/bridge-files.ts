/**
 * Shared bridge-file writer — used by both `haive bridges sync` (explicit) and
 * `haive sync` (auto-refresh of bridges that already exist on disk, so native
 * agent configs never go stale after a pull/merge).
 *
 * Loads the corpus, extracts block sensors from memory frontmatter, generates
 * per-target content, and writes it idempotently: a brand-new file is created
 * whole; an existing file only has its `<!-- haive:* -->` marker blocks replaced,
 * preserving any manual content (and, for Cursor `.mdc`, the YAML frontmatter).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  BRIDGE_MARKERS,
  BRIDGE_TARGET_PATH,
  generateBridges,
  isRetiredMemory,
  loadMemoriesFromDir,
  type BridgeSensor,
  type BridgeTarget,
  type HaivePaths,
} from "@hiveai/core";

export interface WriteBridgesResult {
  created: string[];
  updated: string[];
  unchanged: string[];
  skipped: string[];
  warnings: string[];
}

export interface WriteBridgesOptions {
  targets: BridgeTarget[];
  maxMemories?: number;
  dryRun?: boolean;
  /** When true, skip targets whose file does not already exist (used by `haive sync`). */
  onlyExisting?: boolean;
}

export type BridgeFileState =
  | "missing"
  | "managed"
  | "legacy-managed"
  | "unmanaged"
  | "invalid";

export interface BridgeFileStatus {
  target: BridgeTarget;
  path: string;
  exists: boolean;
  state: BridgeFileState;
  wouldChange: boolean;
  issues: string[];
}

/** Load corpus + sensors and write/refresh the requested bridge files idempotently. */
export async function writeBridgeFiles(
  root: string,
  paths: HaivePaths,
  opts: WriteBridgesOptions,
): Promise<WriteBridgesResult> {
  const result: WriteBridgesResult = { created: [], updated: [], unchanged: [], skipped: [], warnings: [] };
  if (!existsSync(paths.memoriesDir)) return result;

  const allLoaded = await loadMemoriesFromDir(paths.memoriesDir);
  const memories = allLoaded
    .map((l) => l.memory)
    .filter((m) => !isRetiredMemory(m.frontmatter, m.body));

  const sensors: BridgeSensor[] = [];
  for (const m of memories) {
    const sensor = m.frontmatter.sensor;
    if (!sensor || sensor.severity !== "block") continue;
    sensors.push({
      id: m.frontmatter.id,
      severity: "block",
      message: sensor.message,
      ...(sensor.pattern ? { pattern: sensor.pattern } : {}),
      paths: sensor.paths.length > 0 ? sensor.paths : m.frontmatter.anchor.paths,
    });
  }

  const maxMemories = Math.max(1, opts.maxMemories ?? 8);
  const outputs = generateBridges(memories, sensors, { maxMemories, targets: opts.targets });

  for (const output of outputs) {
    const targetFile = path.join(root, output.path);
    const fileExists = existsSync(targetFile);

    if (opts.onlyExisting && !fileExists) continue;

    if (opts.dryRun) {
      if (!fileExists) {
        result.created.push(output.path);
      } else {
        const existing = (await readFile(targetFile, "utf8")).replace(/\r\n/g, "\n");
        const merged = mergeBridgeContent(existing, output.content);
        if (merged.issues.length > 0) {
          result.skipped.push(output.path);
          result.warnings.push(...merged.issues.map((issue) => `${output.path}: ${issue}`));
        } else if (merged.content !== existing) {
          result.updated.push(output.path);
        } else {
          result.unchanged.push(output.path);
        }
      }
      continue;
    }

    await mkdir(path.dirname(targetFile), { recursive: true });

    if (!fileExists) {
      await writeFile(targetFile, output.content, "utf8");
      result.created.push(output.path);
      continue;
    }

    const existing = (await readFile(targetFile, "utf8")).replace(/\r\n/g, "\n");
    const merged = mergeBridgeContent(existing, output.content);

    if (merged.issues.length > 0) {
      result.skipped.push(output.path);
      result.warnings.push(...merged.issues.map((issue) => `${output.path}: ${issue}`));
      continue;
    }

    if (merged.content === existing) {
      result.unchanged.push(output.path);
      continue;
    }

    await writeFile(targetFile, merged.content, "utf8");
    result.updated.push(output.path);
  }

  return result;
}

/** Build per-target status for `haive bridges status` without writing files. */
export async function getBridgeFileStatuses(
  root: string,
  paths: HaivePaths,
  opts: Pick<WriteBridgesOptions, "targets" | "maxMemories">,
): Promise<BridgeFileStatus[]> {
  if (!existsSync(paths.memoriesDir)) {
    return opts.targets.map((target) => ({
      target,
      path: BRIDGE_TARGET_PATH[target],
      exists: false,
      state: "missing",
      wouldChange: false,
      issues: ["No .ai/memories directory found."],
    }));
  }

  const allLoaded = await loadMemoriesFromDir(paths.memoriesDir);
  const memories = allLoaded
    .map((l) => l.memory)
    .filter((m) => !isRetiredMemory(m.frontmatter, m.body));
  const sensors: BridgeSensor[] = [];
  for (const m of memories) {
    const sensor = m.frontmatter.sensor;
    if (!sensor || sensor.severity !== "block") continue;
    sensors.push({
      id: m.frontmatter.id,
      severity: "block",
      message: sensor.message,
      ...(sensor.pattern ? { pattern: sensor.pattern } : {}),
      paths: sensor.paths.length > 0 ? sensor.paths : m.frontmatter.anchor.paths,
    });
  }

  const outputs = generateBridges(memories, sensors, {
    maxMemories: Math.max(1, opts.maxMemories ?? 8),
    targets: opts.targets,
  });

  const statuses: BridgeFileStatus[] = [];
  for (const output of outputs) {
    const targetFile = path.join(root, output.path);
    const exists = existsSync(targetFile);
    if (!exists) {
      statuses.push({
        target: output.target,
        path: output.path,
        exists: false,
        state: "missing",
        wouldChange: true,
        issues: [],
      });
      continue;
    }

    const existing = (await readFile(targetFile, "utf8")).replace(/\r\n/g, "\n");
    const merged = mergeBridgeContent(existing, output.content);
    statuses.push({
      target: output.target,
      path: output.path,
      exists: true,
      state: classifyBridgeFile(existing, merged.issues),
      wouldChange: merged.issues.length === 0 && merged.content !== existing,
      issues: merged.issues,
    });
  }
  return statuses;
}

// ── Marker helpers ───────────────────────────────────────────────────────────

export function extractMarkerBlock(text: string, startMarker: string, endMarker: string): string | null {
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  return text.slice(startIdx, endIdx + endMarker.length);
}

export function replaceMarkerBlock(
  existing: string,
  startMarker: string,
  endMarker: string,
  replacement: string | null,
): string {
  if (!replacement) return existing;
  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return existing + (existing.endsWith("\n") ? "" : "\n") + "\n" + replacement + "\n";
  }
  return existing.slice(0, startIdx) + replacement + existing.slice(endIdx + endMarker.length);
}

interface MergeResult {
  content: string;
  issues: string[];
}

function mergeBridgeContent(existing: string, generated: string): MergeResult {
  const issues = validateKnownMarkers(existing);
  if (issues.length > 0) return { content: existing, issues };

  const generatedBridge =
    extractMarkerBlock(generated, BRIDGE_MARKERS.bridgeStart, BRIDGE_MARKERS.bridgeEnd) ?? generated.trimEnd();
  const replacement = hasExternalHaiveInstructions(existing)
    ? renderCompactManagedBridge(generated)
    : generatedBridge;

  if (hasMarkerPair(existing, BRIDGE_MARKERS.bridgeStart, BRIDGE_MARKERS.bridgeEnd)) {
    return {
      content: replaceMarkerBlock(
        existing,
        BRIDGE_MARKERS.bridgeStart,
        BRIDGE_MARKERS.bridgeEnd,
        replacement,
      ),
      issues,
    };
  }

  if (hasAnyHaiveManagedMarker(existing)) {
    const range = legacyManagedRange(existing);
    if (range) {
      return {
        content: existing.slice(0, range.start) + replacement + existing.slice(range.end),
        issues,
      };
    }
  }

  return {
    content: existing + (existing.endsWith("\n") ? "" : "\n") + "\n" + generatedBridge + "\n",
    issues,
  };
}

function renderCompactManagedBridge(generated: string): string {
  const memories = extractMarkerBlock(generated, BRIDGE_MARKERS.memoriesStart, BRIDGE_MARKERS.memoriesEnd);
  const sensors = extractMarkerBlock(generated, BRIDGE_MARKERS.sensorsStart, BRIDGE_MARKERS.sensorsEnd);
  const parts = [
    BRIDGE_MARKERS.bridgeStart,
    "<!-- AUTO-GENERATED by haive bridges sync — do not edit between these markers -->",
    "",
    memories,
  ].filter((part): part is string => Boolean(part));
  if (sensors) parts.push("", sensors);
  parts.push("", BRIDGE_MARKERS.bridgeEnd);
  return parts.join("\n");
}

function classifyBridgeFile(existing: string, issues: string[]): BridgeFileState {
  if (issues.length > 0) return "invalid";
  if (hasMarkerPair(existing, BRIDGE_MARKERS.bridgeStart, BRIDGE_MARKERS.bridgeEnd)) return "managed";
  if (isLegacyWholeFileBridge(existing) || hasAnyHaiveManagedMarker(existing)) return "legacy-managed";
  return "unmanaged";
}

function validateKnownMarkers(text: string): string[] {
  return [
    ...validateMarkerPair(text, BRIDGE_MARKERS.bridgeStart, BRIDGE_MARKERS.bridgeEnd),
    ...validateMarkerPair(text, BRIDGE_MARKERS.memoriesStart, BRIDGE_MARKERS.memoriesEnd),
    ...validateMarkerPair(text, BRIDGE_MARKERS.sensorsStart, BRIDGE_MARKERS.sensorsEnd),
  ];
}

function validateMarkerPair(text: string, startMarker: string, endMarker: string): string[] {
  const starts = countOccurrences(text, startMarker);
  const ends = countOccurrences(text, endMarker);
  const issues: string[] = [];
  if (starts !== ends) {
    issues.push(`marker mismatch: ${startMarker} (${starts}) vs ${endMarker} (${ends})`);
  }
  if (starts > 1 || ends > 1) {
    issues.push(`multiple marker blocks are not supported for ${startMarker}`);
  }
  if (starts === 1 && ends === 1 && text.indexOf(endMarker) <= text.indexOf(startMarker)) {
    issues.push(`marker order is invalid for ${startMarker}`);
  }
  return issues;
}

function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = text.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = text.indexOf(needle, idx + needle.length);
  }
  return count;
}

function hasMarkerPair(text: string, startMarker: string, endMarker: string): boolean {
  return countOccurrences(text, startMarker) === 1 && countOccurrences(text, endMarker) === 1;
}

function hasAnyHaiveManagedMarker(text: string): boolean {
  return (
    text.includes(BRIDGE_MARKERS.memoriesStart) ||
    text.includes(BRIDGE_MARKERS.sensorsStart)
  );
}

function isLegacyWholeFileBridge(text: string): boolean {
  return text.trimStart().startsWith("<!-- hAIve bridge file") || text.includes("<!-- Managed by hAIve.");
}

function hasExternalHaiveInstructions(text: string): boolean {
  const startIdx = text.indexOf(BRIDGE_MARKERS.bridgeStart);
  const beforeManagedBlock = startIdx === -1 ? text : text.slice(0, startIdx);
  return (
    beforeManagedBlock.includes("Working through hAIve") ||
    beforeManagedBlock.includes("hAIve — mandatory rules") ||
    beforeManagedBlock.includes("hAIve bridge file")
  );
}

function legacyManagedRange(text: string): { start: number; end: number } | null {
  const ranges: Array<{ start: number; end: number }> = [];
  for (const [startMarker, endMarker] of [
    [BRIDGE_MARKERS.memoriesStart, BRIDGE_MARKERS.memoriesEnd],
    [BRIDGE_MARKERS.sensorsStart, BRIDGE_MARKERS.sensorsEnd],
  ] as const) {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker);
    if (start !== -1 && end !== -1 && end > start) {
      ranges.push({ start, end: end + endMarker.length });
    }
  }
  if (ranges.length === 0) return null;
  return {
    start: Math.min(...ranges.map((r) => r.start)),
    end: Math.max(...ranges.map((r) => r.end)),
  };
}
