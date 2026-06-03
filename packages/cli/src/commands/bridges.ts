import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  generateBridges,
  isRetiredMemory,
  loadMemoriesFromDir,
  resolveHaivePaths,
  BRIDGE_TARGET_PATH,
  BRIDGE_TARGETS,
  BRIDGE_MARKERS,
  type BridgeSensor,
  type BridgeTarget,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface BridgesSyncOptions {
  all?: boolean;
  only?: string;
  maxMemories?: string;
  dryRun?: boolean;
  dir?: string;
}

export function registerBridges(program: Command): void {
  const bridges = program
    .command("bridges")
    .description(
      "Generate native agent bridge files from the hAIve corpus.\n" +
      "  Bridges inject top validated memories and block sensors into agent-harness-specific\n" +
      "  config files (.clinerules, .windsurfrules, .continuerules, .sourcegraph/cody-rules.md,\n" +
      "  .rules, AGENTS.md, .github/copilot-instructions.md).\n" +
      "  This is the reach differentiator vs memories.sh: our bridges carry enforcement, not just injection.\n\n" +
      "  Example:\n" +
      "    haive bridges sync --all\n" +
      "    haive bridges sync --only cline,windsurf\n",
    );

  bridges
    .command("sync")
    .description(
      "Regenerate bridge files idempotently (marker-based, preserves manual content outside markers).\n" +
      "  Supported targets: " + BRIDGE_TARGETS.join(", ") + "\n",
    )
    .option("--all", "generate all supported bridge targets")
    .option(
      "--only <targets>",
      "comma-separated list of targets to generate (e.g. cline,windsurf,agents)",
    )
    .option("--max-memories <n>", "max memories to inject per bridge", "8")
    .option("--dry-run", "show what would change without writing")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: BridgesSyncOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const dryRun = opts.dryRun === true;

      if (!existsSync(paths.memoriesDir)) {
        ui.warn(`No .ai/memories at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }

      // ── Determine targets ─────────────────────────────────────────────
      let targets: BridgeTarget[];
      if (opts.only) {
        const requested = opts.only
          .split(",")
          .map((t) => t.trim().toLowerCase())
          .filter(Boolean);
        const invalid = requested.filter((t) => !BRIDGE_TARGETS.includes(t as BridgeTarget));
        if (invalid.length > 0) {
          ui.error(`Unknown bridge target(s): ${invalid.join(", ")}. Valid: ${BRIDGE_TARGETS.join(", ")}`);
          process.exitCode = 1;
          return;
        }
        targets = requested as BridgeTarget[];
      } else if (opts.all) {
        targets = BRIDGE_TARGETS;
      } else {
        // Default: generate only for files that already exist in the project.
        targets = BRIDGE_TARGETS.filter((t) =>
          existsSync(path.join(root, BRIDGE_TARGET_PATH[t])),
        );
        if (targets.length === 0) {
          ui.info(
            "No existing bridge files detected. Pass --all to generate all targets, or " +
            "--only <target> to generate a specific one.",
          );
          return;
        }
      }

      // ── Load memories + sensors ───────────────────────────────────────
      const allLoaded = await loadMemoriesFromDir(paths.memoriesDir);
      const memories = allLoaded
        .map((l) => l.memory)
        .filter((m) => !isRetiredMemory(m.frontmatter, m.body));

      // Extract block sensors from memory frontmatter (no extra imports needed).
      const sensors: BridgeSensor[] = [];
      for (const m of memories) {
        const sensor = m.frontmatter.sensor;
        if (!sensor || sensor.severity !== "block") continue;
        sensors.push({
          id: m.frontmatter.id,
          severity: "block",
          message: sensor.message,
          ...(sensor.pattern ? { pattern: sensor.pattern } : {}),
          paths: sensor.paths.length > 0
            ? sensor.paths
            : m.frontmatter.anchor.paths,
        });
      }

      const maxMemories = Math.max(1, Number(opts.maxMemories ?? 8));

      // ── Generate content ──────────────────────────────────────────────
      const outputs = generateBridges(memories, sensors, { maxMemories, targets });

      // ── Write or update (idempotent) ──────────────────────────────────
      let created = 0;
      let updated = 0;
      let unchanged = 0;

      for (const output of outputs) {
        const targetFile = path.join(root, output.path);

        if (dryRun) {
          const exists = existsSync(targetFile);
          console.log(
            ui.dim(`[dry-run] ${output.target}: ${exists ? "would update" : "would create"} ${output.path}`),
          );
          continue;
        }

        await mkdir(path.dirname(targetFile), { recursive: true });

        if (!existsSync(targetFile)) {
          await writeFile(targetFile, output.content, "utf8");
          console.log(ui.dim(`bridges: created ${output.path}`));
          created++;
          continue;
        }

        // File exists — update the markers blocks only.
        let existing = await readFile(targetFile, "utf8");
        existing = existing.replace(/\r\n/g, "\n");

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
          ? replaceOrAppendMarkerBlock(
              withMemories,
              BRIDGE_MARKERS.sensorsStart,
              BRIDGE_MARKERS.sensorsEnd,
              sensorsBlockContent,
            )
          : withMemories;

        if (withSensors === existing) {
          unchanged++;
          continue;
        }

        await writeFile(targetFile, withSensors, "utf8");
        console.log(ui.dim(`bridges: updated ${output.path}`));
        updated++;
      }

      if (!dryRun) {
        const parts: string[] = [];
        if (created > 0) parts.push(`${created} created`);
        if (updated > 0) parts.push(`${updated} updated`);
        if (unchanged > 0) parts.push(`${unchanged} unchanged`);
        console.log(ui.dim(`bridges: ${parts.join(" · ") || "nothing to do"}`));
      }
    });

  // ── List subcommand ───────────────────────────────────────────────────
  bridges
    .command("list")
    .description("List bridge targets and their status in this project")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: { dir?: string }) => {
      const root = findProjectRoot(opts.dir);
      console.log(ui.bold("hAIve bridge targets:"));
      for (const target of BRIDGE_TARGETS) {
        const relPath = BRIDGE_TARGET_PATH[target];
        const exists = existsSync(path.join(root, relPath));
        const marker = exists ? ui.dim("✓") : ui.dim("·");
        console.log(`  ${marker} ${target.padEnd(10)} ${relPath}${exists ? "" : "  (not present)"}`);
      }
      console.log("");
      console.log(ui.dim("Run `haive bridges sync --all` to generate all targets."));
    });
}

// ── Marker helpers ─────────────────────────────────────────────────────────

function extractMarkerBlock(text: string, startMarker: string, endMarker: string): string | null {
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  return text.slice(startIdx, endIdx + endMarker.length);
}

function replaceMarkerBlock(
  existing: string,
  startMarker: string,
  endMarker: string,
  replacement: string | null,
): string {
  if (!replacement) return existing;
  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // No existing block — append.
    return existing + (existing.endsWith("\n") ? "" : "\n") + "\n" + replacement + "\n";
  }
  return existing.slice(0, startIdx) + replacement + existing.slice(endIdx + endMarker.length);
}

function replaceOrAppendMarkerBlock(
  existing: string,
  startMarker: string,
  endMarker: string,
  replacement: string,
): string {
  return replaceMarkerBlock(existing, startMarker, endMarker, replacement);
}
