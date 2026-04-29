import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  deriveConfidence,
  findProjectRoot,
  getUsage,
  inferModulesFromPaths,
  loadUsageIndex,
  memoryMatchesAnchorPaths,
  resolveHaivePaths,
} from "@hiveai/core";
import { loadMemoriesFromDir } from "../utils/fs.js";
import { ui } from "../utils/ui.js";

interface ForFilesOptions {
  dir?: string;
}

export function registerMemoryForFiles(memory: Command): void {
  memory
    .command("for-files <files...>")
    .description("Show memories relevant to the given files (anchor overlap, module, domain)")
    .option("-d, --dir <dir>", "project root")
    .action(async (files: string[], opts: ForFilesOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}.`);
        process.exitCode = 1;
        return;
      }

      const all = await loadMemoriesFromDir(paths.memoriesDir);
      const usage = await loadUsageIndex(paths);
      const inferred = inferModulesFromPaths(files);

      const byAnchor: typeof all = [];
      const byModule: typeof all = [];
      const byDomain: typeof all = [];
      const seen = new Set<string>();

      for (const loaded of all) {
        if (memoryMatchesAnchorPaths(loaded.memory, files)) {
          byAnchor.push(loaded);
          seen.add(loaded.memory.frontmatter.id);
        }
      }
      const pathSegments = extractPathSegments(files);

      for (const loaded of all) {
        if (seen.has(loaded.memory.frontmatter.id)) continue;
        const fm = loaded.memory.frontmatter;
        const moduleHit =
          (fm.module && inferred.includes(fm.module)) ||
          fm.tags.some((t) => {
            const tl = t.toLowerCase();
            return pathSegments.has(tl) || pathSegments.has(tl.replace(/[-_]/g, ""));
          });
        if (moduleHit) {
          byModule.push(loaded);
          seen.add(fm.id);
        }
      }
      for (const loaded of all) {
        if (seen.has(loaded.memory.frontmatter.id)) continue;
        const domain = loaded.memory.frontmatter.domain;
        if (domain && inferred.includes(domain)) {
          byDomain.push(loaded);
          seen.add(loaded.memory.frontmatter.id);
        }
      }

      console.log(ui.dim(`inferred modules: ${inferred.length ? inferred.join(", ") : "(none)"}`));
      printGroup(root, "anchor overlap", byAnchor, usage);
      printGroup(root, "module match", byModule, usage);
      printGroup(root, "domain match", byDomain, usage);

      const total = byAnchor.length + byModule.length + byDomain.length;
      ui.info(
        `${total} relevant memor${total === 1 ? "y" : "ies"} (${byAnchor.length} anchor · ${byModule.length} module · ${byDomain.length} domain)`,
      );
    });
}

function extractPathSegments(files: string[]): Set<string> {
  const GENERIC = new Set([
    "src", "main", "java", "kotlin", "python", "go", "lib", "libs",
    "com", "org", "net", "io", "app", "apps", "pkg", "internal",
    "test", "tests", "spec", "specs", "impl", "domain", "shared",
    "resources", "static", "assets", "config", "configs",
  ]);
  const out = new Set<string>();
  for (const file of files) {
    const parts = file.replace(/\\/g, "/").split("/");
    for (const part of parts) {
      const seg = part.toLowerCase().replace(/\.[^.]+$/, "");
      if (seg.length >= 3 && !GENERIC.has(seg) && /^[a-z]/.test(seg)) {
        out.add(seg);
        for (const sub of seg.split(/[-_]/).filter((s) => s.length >= 3)) {
          out.add(sub);
        }
      }
    }
  }
  return out;
}

function printGroup(
  root: string,
  label: string,
  loaded: Array<Awaited<ReturnType<typeof loadMemoriesFromDir>>[number]>,
  usage: Awaited<ReturnType<typeof loadUsageIndex>>,
): void {
  if (loaded.length === 0) return;
  console.log(ui.bold(`\n— ${label} —`));
  for (const { memory: mem, filePath } of loaded) {
    const fm = mem.frontmatter;
    const u = getUsage(usage, fm.id);
    const conf = deriveConfidence(fm, u);
    console.log(`${ui.bold(fm.id)}  ${ui.dim(`${fm.scope}/${fm.type}`)}  ${ui.bold(conf)}`);
    console.log(`  ${ui.dim(path.relative(root, filePath))}`);
  }
}
