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
}

export interface WriteBridgesOptions {
  targets: BridgeTarget[];
  maxMemories?: number;
  dryRun?: boolean;
  /** When true, skip targets whose file does not already exist (used by `haive sync`). */
  onlyExisting?: boolean;
}

/** Load corpus + sensors and write/refresh the requested bridge files idempotently. */
export async function writeBridgeFiles(
  root: string,
  paths: HaivePaths,
  opts: WriteBridgesOptions,
): Promise<WriteBridgesResult> {
  const result: WriteBridgesResult = { created: [], updated: [], unchanged: [] };
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
      (fileExists ? result.updated : result.created).push(output.path);
      continue;
    }

    await mkdir(path.dirname(targetFile), { recursive: true });

    if (!fileExists) {
      await writeFile(targetFile, output.content, "utf8");
      result.created.push(output.path);
      continue;
    }

    let existing = (await readFile(targetFile, "utf8")).replace(/\r\n/g, "\n");

    const withMemories = replaceMarkerBlock(
      existing,
      BRIDGE_MARKERS.memoriesStart,
      BRIDGE_MARKERS.memoriesEnd,
      extractMarkerBlock(output.content, BRIDGE_MARKERS.memoriesStart, BRIDGE_MARKERS.memoriesEnd),
    );

    const sensorsBlockContent = extractMarkerBlock(
      output.content,
      BRIDGE_MARKERS.sensorsStart,
      BRIDGE_MARKERS.sensorsEnd,
    );
    const withSensors = sensorsBlockContent
      ? replaceMarkerBlock(withMemories, BRIDGE_MARKERS.sensorsStart, BRIDGE_MARKERS.sensorsEnd, sensorsBlockContent)
      : withMemories;

    if (withSensors === existing) {
      result.unchanged.push(output.path);
      continue;
    }

    await writeFile(targetFile, withSensors, "utf8");
    result.updated.push(output.path);
  }

  return result;
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
