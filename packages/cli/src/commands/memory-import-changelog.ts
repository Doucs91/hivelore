/**
 * hivelore memory import --from-changelog CHANGELOG.md [--package <name>]
 *
 * Parses a CHANGELOG.md file (Keep-a-Changelog format or common variants),
 * extracts breaking changes and notable gotchas from recent versions,
 * and saves them as Hivelore memories.
 *
 * Supports:
 *   - Keep a Changelog (https://keepachangelog.com)
 *   - Angular commit-based CHANGELOG format
 *   - Plain Markdown changelogs with ## headers
 */
import { existsSync } from "node:fs";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  buildFrontmatter,
  findProjectRoot,
  resolveHaivePaths,
  serializeMemory,
} from "@hivelore/core";
import { ui } from "../utils/ui.js";

interface ImportChangelogOptions {
  fromChangelog: string;
  package?: string;
  scope?: string;
  versions?: string;  // e.g. "2.0.0,2.1.0" or "latest"
  dir?: string;
}

interface ChangelogEntry {
  version: string;
  breaking: string[];
  deprecated: string[];
  removed: string[];
  fixed: string[];
  added: string[];
}

// ── Parser ─────────────────────────────────────────────────────────────────

function parseChangelog(content: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const versionRe = /^#{1,3}\s+(?:\[?)([0-9]+\.[0-9]+[.0-9]*)/m;
  const sections = content.split(/^#{1,3}\s+/m).slice(1);

  for (const section of sections) {
    const versionMatch = section.match(/^(?:\[?)([0-9]+\.[0-9]+[.0-9]*)/);
    const version = versionMatch?.[1];
    if (!version) continue;

    const entry: ChangelogEntry = {
      version,
      breaking: [],
      deprecated: [],
      removed: [],
      fixed: [],
      added: [],
    };

    // Extract sub-sections
    const subSections = section.split(/^#{2,4}\s+/m);
    for (const sub of subSections) {
      const firstLine = (sub.split("\n")[0] ?? "").toLowerCase().trim();
      const items = sub
        .split("\n")
        .slice(1)
        .filter((l) => l.trim().startsWith("-") || l.trim().startsWith("*"))
        .map((l) => l.replace(/^[\s\-*]+/, "").trim())
        .filter(Boolean);

      if (/breaking/.test(firstLine)) {
        entry.breaking.push(...items);
      } else if (/deprecated/.test(firstLine)) {
        entry.deprecated.push(...items);
      } else if (/removed/.test(firstLine)) {
        entry.removed.push(...items);
      } else if (/fixed|bug/.test(firstLine)) {
        entry.fixed.push(...items);
      } else if (/added|new|feat/.test(firstLine)) {
        entry.added.push(...items);
      }

      // Also scan for BREAKING CHANGE: prefixes in all items (Angular format)
      for (const sub2 of subSections) {
        for (const line of sub2.split("\n")) {
          const breakingMatch = line.match(/BREAKING CHANGE[S]?:\s*(.+)/i);
          const breakingText = breakingMatch?.[1]?.trim();
          if (breakingText && !entry.breaking.includes(breakingText)) {
            entry.breaking.push(breakingText);
          }
        }
      }
    }

    // If no sub-sections matched, do a raw scan for breaking change indicators
    if (entry.breaking.length === 0) {
      for (const line of section.split("\n")) {
        if (/breaking|⚠|deprecated|removed/.test(line.toLowerCase())) {
          const item = line.replace(/^[\s\-*#]+/, "").trim();
          if (item) entry.breaking.push(item);
        }
      }
    }

    const hasContent =
      entry.breaking.length > 0 ||
      entry.deprecated.length > 0 ||
      entry.removed.length > 0;

    if (hasContent) entries.push(entry);
  }

  void versionRe; // used implicitly in section splitting
  return entries;
}

// ── CLI command ─────────────────────────────────────────────────────────────

export function registerMemoryImportChangelog(memory: Command): void {
  memory
    .command("import-changelog")
    .description(
      "Import breaking changes from a CHANGELOG.md as Hivelore memories.\n\n" +
      "  Parses Keep-a-Changelog and Angular commit format changelogs,\n" +
      "  extracts breaking changes, deprecations, and removals,\n" +
      "  and saves each version's changes as a gotcha memory.\n\n" +
      "  Examples:\n" +
      "    hivelore memory import-changelog --from node_modules/@company/sdk/CHANGELOG.md --package @company/sdk\n" +
      "    hivelore memory import-changelog --from CHANGELOG.md\n" +
      "    hivelore memory import-changelog --from CHANGELOG.md --versions 2.0.0,2.1.0\n",
    )
    .requiredOption("--from <file>", "path to the CHANGELOG.md file")
    .option("--package <name>", "name of the package (used in memory title and tags)")
    .option("--scope <scope>", "memory scope: team | personal (default: team)", "team")
    .option(
      "--versions <csv>",
      "only import specific versions (comma-separated), or 'latest' for the most recent breaking version",
    )
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: ImportChangelogOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);

      const changelogPath = path.resolve(root, opts.fromChangelog);
      if (!existsSync(changelogPath)) {
        ui.error(`CHANGELOG not found: ${changelogPath}`);
        process.exitCode = 1;
        return;
      }

      const content = await readFile(changelogPath, "utf8");
      let entries = parseChangelog(content);

      if (entries.length === 0) {
        ui.warn("No breaking changes, deprecations, or removals found in the CHANGELOG.");
        return;
      }

      // Filter by versions if specified
      if (opts.versions) {
        if (opts.versions === "latest") {
          const latest = entries[0];
          entries = latest ? [latest] : [];
        } else {
          const requested = opts.versions.split(",").map((v) => v.trim());
          entries = entries.filter((e) => requested.includes(e.version));
        }
      }

      const pkgName = opts.package ?? path.basename(path.dirname(changelogPath));
      const scope = (opts.scope ?? "team") as "team" | "personal";
      const teamDir = path.join(paths.memoriesDir, scope);
      await mkdir(teamDir, { recursive: true });

      let saved = 0;
      for (const entry of entries) {
        const lines: string[] = [];
        lines.push(`## ${pkgName} v${entry.version} — Breaking Changes & Deprecations\n`);

        if (entry.breaking.length > 0) {
          lines.push("### 🔴 Breaking Changes\n");
          for (const item of entry.breaking) lines.push(`- ${item}`);
          lines.push("");
        }
        if (entry.deprecated.length > 0) {
          lines.push("### 🟡 Deprecated\n");
          for (const item of entry.deprecated) lines.push(`- ${item}`);
          lines.push("");
        }
        if (entry.removed.length > 0) {
          lines.push("### ⚫ Removed\n");
          for (const item of entry.removed) lines.push(`- ${item}`);
          lines.push("");
        }

        lines.push(
          `**Source:** \`${path.relative(root, changelogPath)}\`  \n` +
          `**Action:** Update all usages of ${pkgName} if they rely on any of the above.`,
        );

        const slug = `changelog-${pkgName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}-v${entry.version.replace(/\./g, "-")}`;
        const fm = buildFrontmatter({
          type: "gotcha",
          slug,
          scope,
          status: "validated",
          tags: [
            "changelog",
            "breaking-change",
            pkgName.replace(/[^a-z0-9]/gi, "-").toLowerCase(),
            `v${entry.version}`,
          ],
          paths: [path.relative(root, changelogPath)],
          topic: `changelog-${pkgName}-${entry.version}`,
        });

        await writeFile(
          path.join(teamDir, `${fm.id}.md`),
          serializeMemory({ frontmatter: fm, body: lines.join("\n") }),
          "utf8",
        );
        console.log(ui.green(`  ✓ ${fm.id}`));
        saved++;
      }

      console.log(
        `\n${ui.bold(`Imported ${saved} changelog entr${saved === 1 ? "y" : "ies"} from ${pkgName}`)}`,
      );
      if (saved > 0) {
        console.log(
          ui.dim(`  Memories saved to .ai/memories/${scope}/`),
        );
        console.log(
          ui.dim(`  Run \`hivelore briefing --task "update ${pkgName}"\` to see them in context.`),
        );
      }
    });
}
