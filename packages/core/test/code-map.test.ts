import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCodeMap, queryCodeMap } from "../src/code-map.js";

const exec = promisify(execFile);

describe("buildCodeMap", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(path.join(tmpdir(), "haive-codemap-"));
    await mkdir(path.join(workDir, "src"), { recursive: true });
    await mkdir(path.join(workDir, "node_modules", "junk"), { recursive: true });
    await writeFile(
      path.join(workDir, "src", "math.ts"),
      `/**
 * Numeric helpers.
 */

/** Adds two numbers. */
export function add(a: number, b: number): number {
  return a + b;
}

// One-liner doc.
export const PI = 3.14;

export interface Vec2 { x: number; y: number; }

export type Pair<T> = [T, T];

export class Rect {
  constructor(public w: number, public h: number) {}
}
`,
      "utf8",
    );
    await writeFile(
      path.join(workDir, "src", "internal.ts"),
      `function helper() { return 1; }
const SECRET = 42;
`,
      "utf8",
    );
    await writeFile(
      path.join(workDir, "node_modules", "junk", "noise.ts"),
      `export const NOISE = true;`,
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("indexes only files with exports and skips excluded dirs", async () => {
    const map = await buildCodeMap(workDir);
    expect(Object.keys(map.files)).toEqual(["src/math.ts"]);
  });

  it("captures function/class/interface/type/const exports with descriptions", async () => {
    const map = await buildCodeMap(workDir);
    const entry = map.files["src/math.ts"]!;
    expect(entry.exports.map((e) => e.name).sort()).toEqual([
      "PI",
      "Pair",
      "Rect",
      "Vec2",
      "add",
    ]);
    const add = entry.exports.find((e) => e.name === "add")!;
    expect(add.kind).toBe("function");
    expect(add.description).toBe("Adds two numbers.");
    const pi = entry.exports.find((e) => e.name === "PI")!;
    expect(pi.description).toBe("One-liner doc.");
  });

  it("captures the file-level header summary", async () => {
    const map = await buildCodeMap(workDir);
    expect(map.files["src/math.ts"]!.summary).toBe("Numeric helpers.");
  });

  it("excludes dirs via custom excludeDirs", async () => {
    await mkdir(path.join(workDir, "out"), { recursive: true });
    await writeFile(
      path.join(workDir, "out", "skip.ts"),
      `export const X = 1;`,
      "utf8",
    );
    const map = await buildCodeMap(workDir, { excludeDirs: ["node_modules", "out"] });
    expect(Object.keys(map.files)).toEqual(["src/math.ts"]);
  });

  it("uses tracked git files when available and skips ignored worktrees", async () => {
    await exec("git", ["init"], { cwd: workDir });
    await writeFile(path.join(workDir, ".gitignore"), "sandbox/\n", "utf8");
    await mkdir(path.join(workDir, "sandbox"), { recursive: true });
    await writeFile(
      path.join(workDir, "sandbox", "ignored.ts"),
      `export const IGNORED = true;`,
      "utf8",
    );
    await exec("git", ["add", ".gitignore", "src/math.ts"], { cwd: workDir });

    const map = await buildCodeMap(workDir);

    expect(Object.keys(map.files)).toEqual(["src/math.ts"]);
  });
});

describe("queryCodeMap", () => {
  it("filters by file substring", async () => {
    const map = {
      version: 1 as const,
      generated_at: "2026-04-26T00:00:00.000Z",
      root: "/r",
      files: {
        "a/x.ts": { exports: [{ name: "foo", kind: "function" as const, line: 1 }], loc: 1 },
        "b/y.ts": { exports: [{ name: "bar", kind: "function" as const, line: 1 }], loc: 1 },
      },
    };
    expect(queryCodeMap(map, { file: "a/" }).files.length).toBe(1);
    expect(queryCodeMap(map, { symbol: "bar" }).files.length).toBe(1);
    expect(queryCodeMap(map, { symbol: "BAR" }).files.length).toBe(1);
    expect(queryCodeMap(map, {}).files.length).toBe(2);
  });
});
