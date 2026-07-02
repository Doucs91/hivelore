/**
 * `hivelore merge-driver` — deterministic git merge driver for Hivelore memory files.
 *
 * Several agents + the human edit `.ai/` in parallel with manual pull/push, so memory files
 * (especially the topic-upsert session recap) regularly collide and leave `<<<<<<<` markers. A
 * memory has a total order in its frontmatter (revision_count → created_at), so the conflict is
 * mechanically resolvable. This registers as a git merge driver via `.gitattributes`.
 *
 *   hivelore merge-driver install   # one-time: git config + .gitattributes block
 *   hivelore merge-driver run %O %A %B # invoked by git (writes the winner into %A, exits 0)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProjectRoot, mergeMemoryVersions } from "@hivelore/core";
import { ui } from "../utils/ui.js";

const GITATTRIBUTES_MARK = "# Hivelore merge driver";
const GITATTRIBUTES_BLOCK = [
  GITATTRIBUTES_MARK,
  ".ai/memories/**/*.md merge=haive",
  "# Hivelore merge driver end",
].join("\n");

export function registerMergeDriver(program: Command): void {
  const cmd = program
    .command("merge-driver")
    .description("Deterministic git merge driver for Hivelore memory files (kills .ai/ conflict markers)");

  cmd
    .command("run <base> <ours> <theirs>")
    .description("Git merge-driver entrypoint: resolve ours/theirs by frontmatter order, write into <ours>")
    .action((base: string, ours: string, theirs: string) => {
      // A merge driver MUST be robust: any throw should fall back to a real conflict (exit 1),
      // never crash git. Read ours/theirs, pick the winner, write it back into <ours>.
      try {
        const oursContent = readFileSync(ours, "utf8");
        const theirsContent = readFileSync(theirs, "utf8");
        const result = mergeMemoryVersions(oursContent, theirsContent);
        if (result.content !== oursContent) writeFileSync(ours, result.content, "utf8");
        // exit 0 = resolved
        process.exit(0);
      } catch {
        // Could not resolve — let git record a normal conflict.
        process.exit(1);
      }
    });

  cmd
    .command("install")
    .description("Configure git + .gitattributes so memory-file conflicts auto-resolve")
    .option("-d, --dir <dir>", "project root")
    .action((opts: { dir?: string }) => {
      const root = findProjectRoot(opts.dir);
      try {
        execFileSync("git", ["config", "merge.haive.name", "Hivelore memory merge driver"], { cwd: root });
        execFileSync("git", ["config", "merge.haive.driver", "hivelore merge-driver run %O %A %B"], { cwd: root });
      } catch {
        ui.error("Could not set git config — is this a git repository?");
        process.exitCode = 1;
        return;
      }

      const gaPath = path.join(root, ".gitattributes");
      let content = existsSync(gaPath) ? readFileSync(gaPath, "utf8") : "";
      if (!content.includes(GITATTRIBUTES_MARK)) {
        if (content.length > 0 && !content.endsWith("\n")) content += "\n";
        content += GITATTRIBUTES_BLOCK + "\n";
        writeFileSync(gaPath, content, "utf8");
        ui.success("Installed Hivelore merge driver (git config + .gitattributes).");
      } else {
        ui.info("Hivelore merge driver already present in .gitattributes — refreshed git config.");
      }
      ui.info("Memory-file conflicts under .ai/memories/ now resolve by revision_count → created_at.");
    });
}
