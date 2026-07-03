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
import { z } from "zod";
import {
  loadMemoriesFromDir,
  normalizeFramework,
  parseLessonFields,
  pickTestFramework,
  scaffoldPostIncidentTest,
  type TestFramework,
} from "@hivelore/core";
import type { HaiveContext } from "../context.js";

const PY_SIGNALS = ["pyproject.toml", "setup.py", "pytest.ini", "requirements.txt", "tox.ini"];

/**
 * Detect the test framework + owning package dir (repo-relative) for an incident's anchor paths.
 * Walks up from each anchor path's directory to the repo root and uses the NEAREST enclosing manifest
 * (package.json / go.mod / a python signal); falls back to the repo root with a vitest default. This
 * is FS I/O, so it lives in the MCP layer (imported by the CLI too) rather than in pure core.
 */
export async function detectTestFrameworkForPaths(
  root: string,
  anchorPaths: string[],
): Promise<{ framework: TestFramework; baseDir: string }> {
  const starts = anchorPaths.length > 0 ? anchorPaths : ["."];
  for (const rel of starts) {
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
  }
  return { framework: "vitest", baseDir: "" };
}

export const ScaffoldTestInputSchema = {
  memory_id: z.string().min(1).describe("Id of the attempt/gotcha lesson to scaffold a post-incident test from."),
  framework: z
    .enum(["vitest", "jest", "pytest", "gotest"])
    .optional()
    .describe("Test framework. Auto-detected from the package that owns the lesson's anchor paths when omitted."),
  out_path: z.string().optional().describe("Override the generated test file path (repo-relative)."),
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
}

export async function scaffoldTest(input: ScaffoldTestInput, ctx: HaiveContext): Promise<ScaffoldTestOutput> {
  const loaded = existsSync(ctx.paths.memoriesDir) ? await loadMemoriesFromDir(ctx.paths.memoriesDir) : [];
  const found = loaded.find(({ memory }) => memory.frontmatter.id === input.memory_id);
  if (!found) {
    return { ok: false, error: `No memory found with id ${input.memory_id}`, memory_id: input.memory_id };
  }

  const anchorPaths = found.memory.frontmatter.anchor.paths ?? [];
  const detected = await detectTestFrameworkForPaths(ctx.paths.root, anchorPaths);
  const framework = input.framework ? normalizeFramework(input.framework) ?? detected.framework : detected.framework;

  const fields = parseLessonFields(found.memory.body);
  const scaffold = scaffoldPostIncidentTest(
    {
      memoryId: input.memory_id,
      title: fields.title || input.memory_id,
      whyFailed: fields.whyFailed,
      instead: fields.instead,
      incident: found.memory.frontmatter.sensor?.incident,
      paths: anchorPaths,
    },
    { framework, outPath: input.out_path, baseDir: detected.baseDir },
  );

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

  return {
    ok: true,
    memory_id: input.memory_id,
    framework,
    path: scaffold.relPath,
    run_command: scaffold.runCommand,
    propose_command: scaffold.proposeCommand,
    content: scaffold.content,
    written,
    already_exists: alreadyExists,
    notice: alreadyExists
      ? "File already exists — not overwritten. Delete it or pass out_path to write elsewhere."
      : "PENDING test scaffolded. Fill in the assertion (RED on the incident, GREEN once fixed), run it, then arm it with propose_command — propose_sensor stays the sole validated writer.",
  };
}
