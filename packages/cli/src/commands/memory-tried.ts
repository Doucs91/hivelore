import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  buildFrontmatter,
  findProjectRoot,
  memoryFilePath,
  resolveHaivePaths,
  serializeMemory,
  suggestSensorSeed,
  type MemoryScope,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

interface TriedOptions {
  what: string;
  whyFailed: string;
  instead?: string;
  scope?: MemoryScope;
  module?: string;
  tags?: string;
  paths?: string;
  files?: string;
  author?: string;
  dir?: string;
}

export function registerMemoryTried(memory: Command): void {
  memory
    .command("tried")
    .description(
      "Record a FAILED approach — prevents repeated mistakes in future sessions.\n\n" +
      "  This is the most valuable type of negative knowledge. It surfaces FIRST in\n" +
      "  get_briefing so agents can't miss it. Auto-validated (no approval cycle).\n\n" +
      "  Use this immediately when you try something and it fails.\n\n" +
      "  Example:\n" +
      "    hivelore memory tried \\\\\n" +
      "      --what \"importing X with ESM dynamic import\" \\\\\n" +
      "      --why-failed \"tsup bundles it as CJS, dynamic import fails at runtime\" \\\\\n" +
      "      --instead \"use static import in the entry file\" \\\\\n" +
      "      --paths packages/cli/src/index.ts\n",
    )
    .requiredOption("--what <text>", "what approach was tried (short, descriptive title)")
    .requiredOption("--why-failed <text>", "why it failed or should NOT be used (include the exact error if possible)")
    .option("--instead <text>", "the correct approach to use instead")
    .option("--scope <scope>", "personal | team | module", "personal")
    .option("--module <name>", "module name (required when scope=module)")
    .option("--tags <csv>", "comma-separated tags")
    .option("--paths <csv>", "anchor paths, comma-separated")
    .option("--files <csv>", "alias for --paths (matches the MCP `files` parameter)")
    .option("--author <author>", "author email or handle")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: TriedOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.haiveDir)) {
        ui.error(`No .ai/ found at ${root}. Run \`hivelore init\` first.`);
        process.exitCode = 1;
        return;
      }

      const slug = opts.what
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .trim()
        .split(/\s+/)
        .slice(0, 5)
        .join("-");

      const baseFm = buildFrontmatter({
        type: "attempt",
        slug,
        scope: opts.scope,
        module: opts.module,
        tags: parseCsv(opts.tags),
        paths: parseCsv(opts.paths ?? opts.files),
        author: opts.author,
      });
      // attempt memories are immediately validated — no review cycle needed
      const frontmatter = { ...baseFm, status: "validated" as const };

      const lines: string[] = [`# ${opts.what}`, ""];
      lines.push(`**Why it failed / do NOT use:** ${opts.whyFailed}`);
      if (opts.instead) {
        lines.push("", `**Instead, use:** ${opts.instead}`);
      }
      const body = lines.join("\n") + "\n";

      const file = memoryFilePath(paths, frontmatter.scope, frontmatter.id, frontmatter.module);
      await mkdir(path.dirname(file), { recursive: true });

      if (existsSync(file)) {
        ui.error(`Memory already exists at ${file}`);
        process.exitCode = 1;
        return;
      }

      await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");
      ui.success(`Recorded: ${path.relative(root, file)}`);
      ui.info(`id=${frontmatter.id}  type=attempt  status=validated (auto-approved)`);
      // A captured attempt closes its loop only once a sensor is VALIDATED via propose_sensor. We no
      // longer auto-write a heuristic warn sensor; surface a candidate SEED (when derivable) instead.
      const seed = frontmatter.anchor.paths.length > 0 ? suggestSensorSeed(body, frontmatter.anchor.paths) : null;
      if (frontmatter.anchor.paths.length === 0) {
        ui.warn("No --paths — lesson is briefed but NOT enforced. Add --paths, then call propose_sensor (MCP) to close the loop.");
      } else if (seed) {
        ui.warn("Lesson NOT yet enforced — close the loop with a validated sensor via propose_sensor (MCP).");
        ui.info(
          `  candidate pattern=${JSON.stringify(seed.pattern)}` +
          (seed.absent ? `  absent=${JSON.stringify(seed.absent)}` : "") +
          "  — refine, then validate (silent on current code, fires on the bad example).",
        );
      } else {
        ui.warn(
          "Lesson NOT yet enforced and no candidate pattern could be derived. Author a discriminating " +
          "sensor (pattern = faulty usage, absent = correct-usage marker) via propose_sensor.",
        );
      }
    });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}
