/**
 * scaffold_test — generate a PENDING post-incident test from a lesson, so an agent can go from a
 * captured mistake to a routed command sensor within the same session. Mirrors the CLI
 * `hivelore sensors scaffold`.
 *
 * DOCTRINE: it NEVER arms a sensor — `propose_sensor` stays the sole validated writer. It writes a
 * pending stub (todo/skip, so the suite stays green) and returns the exact `sensors propose --kind
 * test` command. Monorepo-aware: the framework and file location come from the package that OWNS the
 * incident's anchor paths, not the repo root.
 */
import { existsSync, statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import {
  buildProposeCommand,
  incidentHintsFromDiff,
  loadMemoriesFromDir,
  normalizeFramework,
  parseLessonFields,
  pickTestFramework,
  scaffoldPostIncidentTest,
  type IncidentHints,
  type PostIncidentLesson,
  type TestFramework,
} from "@hivelore/core";
import type { HaiveContext } from "../context.js";

const execFileAsync = promisify(execFile);

/**
 * Read `git diff <redRef> HEAD -- <paths>` with an argument array (no shell interpolation — see
 * convention 2026-07-05-convention-child-process-no-shell-interpolation). Large maxBuffer so a big
 * fix diff is readable; the caller treats any throw as "no hints, use the generic template".
 */
async function gitDiffText(root: string, redRef: string, paths: string[]): Promise<string> {
  const args = ["diff", redRef, "HEAD", "--", ...paths];
  const { stdout } = await execFileAsync("git", args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
}

const PY_SIGNALS = ["pyproject.toml", "setup.py", "pytest.ini", "requirements.txt", "tox.ini"];

/**
 * Detect the test framework + owning package dir (repo-relative) for an incident's anchor paths.
 * Walks up from each anchor path's directory to the repo root and uses the NEAREST enclosing manifest
 * (package.json / go.mod / a python signal); falls back to the repo root with a vitest default. This
 * is FS I/O, so it lives in the MCP layer (imported by the CLI too) rather than in pure core.
 */
async function detectForAnchor(
  root: string,
  rel: string,
): Promise<{ framework: TestFramework; baseDir: string } | null> {
  let dir = path.resolve(root, rel);
  try {
    if (!statSync(dir).isDirectory()) dir = path.dirname(dir);
  } catch {
    if (path.extname(dir)) dir = path.dirname(dir); // non-existent anchor that looks like a file
  }
  while (dir.startsWith(root)) {
    const pkgJson = path.join(dir, "package.json");
    const hasPkg = existsSync(pkgJson);
    const goMod = existsSync(path.join(dir, "go.mod"));
    const pySignal = PY_SIGNALS.some((s) => existsSync(path.join(dir, s)));
    if (hasPkg || goMod || pySignal) {
      let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null = null;
      if (hasPkg) {
        try {
          pkg = JSON.parse(await readFile(pkgJson, "utf8"));
        } catch {
          pkg = null;
        }
      }
      const baseDir = path.relative(root, dir).split(path.sep).join("/");
      return { framework: pickTestFramework(pkg, { goMod, pySignal }), baseDir };
    }
    const parent = path.dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return null;
}

export async function detectTestFrameworkForPaths(
  root: string,
  anchorPaths: string[],
): Promise<{ framework: TestFramework; baseDir: string }> {
  const starts = anchorPaths.length > 0 ? anchorPaths : ["."];
  for (const rel of starts) {
    const found = await detectForAnchor(root, rel);
    if (found) return found;
  }
  return { framework: "vitest", baseDir: "" };
}

export interface AnchorFrameworkGroup {
  framework: TestFramework;
  baseDir: string;
  /** The anchor paths owned by this package (subset of the lesson's anchors). */
  anchors: string[];
}

/**
 * Group a lesson's anchor paths by OWNING package: one entry per distinct enclosing manifest dir,
 * in first-anchor order. A lesson that spans several packages gets one scaffold per package instead
 * of "first anchor wins". Anchors with no enclosing manifest fall back to the repo root + vitest.
 */
export async function detectTestFrameworksForAnchors(
  root: string,
  anchorPaths: string[],
): Promise<AnchorFrameworkGroup[]> {
  const starts = anchorPaths.length > 0 ? anchorPaths : ["."];
  const groups = new Map<string, AnchorFrameworkGroup>();
  for (const rel of starts) {
    const found = (await detectForAnchor(root, rel)) ?? { framework: "vitest" as TestFramework, baseDir: "" };
    const existing = groups.get(found.baseDir);
    if (existing) existing.anchors.push(rel);
    else groups.set(found.baseDir, { ...found, anchors: [rel] });
  }
  return [...groups.values()];
}

export const ScaffoldTestInputSchema = {
  memory_id: z.string().min(1).describe("Id of the attempt/gotcha lesson to scaffold a post-incident test from."),
  framework: z
    .enum(["vitest", "jest", "pytest", "gotest"])
    .optional()
    .describe("Test framework. Auto-detected from the package that owns the lesson's anchor paths when omitted."),
  out_path: z.string().optional().describe("Override the generated test file path (repo-relative)."),
  style: z
    .enum(["example", "property", "differential"])
    .optional()
    .describe(
      "Test shape (default 'example'): 'property' states the invariant once and checks it over many " +
        "generated inputs (fast-check/Hypothesis); 'differential' asserts the subject agrees with a " +
        "`reference` implementation for all inputs. Both lower the cost of expressing the invariant.",
    ),
  reference: z
    .string()
    .optional()
    .describe("Required for style='differential': import specifier of the reference implementation to compare against."),
  red_ref: z
    .string()
    .optional()
    .describe(
      "Pre-fix incident commit/ref. When set, the scaffold names the symbols the fix (<red_ref>..HEAD) " +
        "touched within the lesson's anchor scope and pre-fills the example around them, so the assertion " +
        "is a targeted edit rather than a blank page. A bad ref falls back to the generic template.",
    ),
  write: z
    .boolean()
    .default(true)
    .describe("Write the file to disk (default). false = return the content for preview without writing."),
};

export type ScaffoldTestInput = {
  [K in keyof typeof ScaffoldTestInputSchema]: z.infer<(typeof ScaffoldTestInputSchema)[K]>;
};

export interface ScaffoldTestOutput {
  ok: boolean;
  error?: string;
  memory_id: string;
  framework?: TestFramework;
  /** Repo-relative path of the generated (or would-be) test file. */
  path?: string;
  /** Command that runs ONLY this test — becomes the sensor's oracle once the assertion is written. */
  run_command?: string;
  /** The exact `sensors propose --kind test` command to arm it AFTER the assertion is written. */
  propose_command?: string;
  content?: string;
  written?: boolean;
  already_exists?: boolean;
  notice?: string;
  /**
   * One entry per generated test. A lesson whose anchors span several packages scaffolds one test
   * per OWNING package; they share a single propose_command (a memory carries one sensor) whose
   * command chains every run command.
   */
  scaffolds?: Array<{
    framework: TestFramework;
    path: string;
    run_command: string;
    content: string;
    written: boolean;
    already_exists: boolean;
  }>;
}

export async function scaffoldTest(input: ScaffoldTestInput, ctx: HaiveContext): Promise<ScaffoldTestOutput> {
  const loaded = existsSync(ctx.paths.memoriesDir) ? await loadMemoriesFromDir(ctx.paths.memoriesDir) : [];
  const found = loaded.find(({ memory }) => memory.frontmatter.id === input.memory_id);
  if (!found) {
    return { ok: false, error: `No memory found with id ${input.memory_id}`, memory_id: input.memory_id };
  }

  const style = input.style ?? "example";
  if (style === "differential" && !input.reference) {
    return { ok: false, error: "style='differential' requires `reference` (the reference implementation to compare against).", memory_id: input.memory_id };
  }
  const anchorPaths = found.memory.frontmatter.anchor.paths ?? [];
  // Multi-package lessons: one scaffold per OWNING package (no more "first anchor wins").
  // An explicit out_path pins a single file, so only the first group is used in that case.
  const allGroups = await detectTestFrameworksForAnchors(ctx.paths.root, anchorPaths);
  const groups = input.out_path ? allGroups.slice(0, 1) : allGroups;
  const frameworkFor = (detected: TestFramework): TestFramework =>
    input.framework ? normalizeFramework(input.framework) ?? detected : detected;

  const fields = parseLessonFields(found.memory.body);
  // red_ref: derive the fix's changed symbols/files from `git diff <ref>..HEAD` scoped to the
  // lesson's anchors. Best-effort — a bad ref just yields the generic template.
  let incidentHints: IncidentHints | undefined;
  if (input.red_ref) {
    try {
      const diff = await gitDiffText(ctx.paths.root, input.red_ref, anchorPaths);
      const hints = incidentHintsFromDiff(diff, { redRef: input.red_ref });
      if (hints.changedSymbols.length > 0 || hints.changedFiles.length > 0) incidentHints = hints;
    } catch { /* fall back to the generic template */ }
  }
  const lesson: PostIncidentLesson = {
    memoryId: input.memory_id,
    title: fields.title || input.memory_id,
    whyFailed: fields.whyFailed,
    instead: fields.instead,
    incident: found.memory.frontmatter.sensor?.incident,
    paths: anchorPaths,
    incidentHints,
  };

  // Pass 1: per-group scaffolds (collects each run command). A memory carries ONE sensor, so when
  // several packages are involved, pass 2 re-renders every file with the SHARED propose command
  // whose oracle chains all run commands.
  const styleOpts = { style, reference: input.reference };
  let scaffolds = groups.map((g) =>
    scaffoldPostIncidentTest(lesson, { framework: frameworkFor(g.framework), outPath: input.out_path, baseDir: g.baseDir, ...styleOpts }),
  );
  let proposeCommand = scaffolds[0]!.proposeCommand;
  if (scaffolds.length > 1) {
    proposeCommand = buildProposeCommand(lesson, scaffolds.map((s) => s.runCommand).join(" && "));
    scaffolds = groups.map((g) =>
      scaffoldPostIncidentTest(lesson, {
        framework: frameworkFor(g.framework),
        baseDir: g.baseDir,
        proposeCommandOverride: proposeCommand,
        ...styleOpts,
      }),
    );
  }

  const results: NonNullable<ScaffoldTestOutput["scaffolds"]> = [];
  for (const scaffold of scaffolds) {
    const abs = path.isAbsolute(scaffold.relPath) ? scaffold.relPath : path.resolve(ctx.paths.root, scaffold.relPath);
    let written = false;
    let alreadyExists = false;
    if (input.write) {
      if (existsSync(abs)) {
        alreadyExists = true;
      } else {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, scaffold.content, "utf8");
        written = true;
      }
    }
    results.push({
      framework: scaffold.framework,
      path: scaffold.relPath,
      run_command: scaffold.runCommand,
      content: scaffold.content,
      written,
      already_exists: alreadyExists,
    });
  }

  const first = results[0]!;
  const anyExisting = results.some((r) => r.already_exists);
  return {
    ok: true,
    memory_id: input.memory_id,
    framework: first.framework,
    path: first.path,
    run_command: first.run_command,
    propose_command: proposeCommand,
    content: first.content,
    written: first.written,
    already_exists: first.already_exists,
    ...(results.length > 1 ? { scaffolds: results } : {}),
    notice:
      (results.length > 1
        ? `Lesson spans ${results.length} packages — one pending test per owning package; ONE propose_command arms them all (chained oracle). `
        : "") +
      (anyExisting
        ? "Some file(s) already exist — not overwritten. Delete them or pass out_path to write elsewhere."
        : "PENDING test scaffolded. Fill in the assertion (RED on the incident, GREEN once fixed), run it, then arm it with propose_command — propose_sensor stays the sole validated writer."),
  };
}
