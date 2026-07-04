/**
 * Post-incident test scaffolding — turn a captured lesson (`mem_tried` / attempt / gotcha) into a
 * PENDING test file the team fills in, then arms as a command-sensor oracle.
 *
 * This is the behaviour-harness bridge's on-ramp: `mem_tried` records *what* failed and *why*, but a
 * command sensor needs the team's own test as the oracle — and someone has to write it. This module
 * removes that friction by generating the test skeleton (header provenance + a pending test + a
 * commented example derived from the lesson) plus the exact `sensors propose --kind test` line.
 *
 * DOCTRINE: this NEVER arms a sensor. It only writes a stub and prints the wiring command. Arming
 * stays with `propose_sensor`, the sole validated writer of live sensors (silent-on-current /
 * fires-on-bad). The generated test is deliberately PENDING (todo/skip) so the suite stays green and
 * an empty stub can't masquerade as a passing oracle. Pure: no I/O — the caller writes the file.
 */

export type TestFramework = "vitest" | "jest" | "pytest" | "gotest";

export const TEST_FRAMEWORKS: readonly TestFramework[] = ["vitest", "jest", "pytest", "gotest"];

export interface PostIncidentLesson {
  /** Memory id the scaffold is generated from. */
  memoryId: string;
  /** Short "what was tried / what failed" title (the lesson's heading). */
  title: string;
  /** Why it failed / must not be used. */
  whyFailed?: string;
  /** The correct approach / expected behaviour. */
  instead?: string;
  /** Incident provenance (ticket/prod ref) carried into the sensor when armed. */
  incident?: string;
  /** Anchor paths — used to scope the sensor and to place the test near the code. */
  paths?: string[];
}

export interface TestScaffold {
  framework: TestFramework;
  /** Suggested project-relative path for the generated test file. */
  relPath: string;
  /** File contents (a pending test with provenance + a commented example). */
  content: string;
  /** Command that runs ONLY this test — becomes the sensor's oracle command once filled in. */
  runCommand: string;
  /** Ready-to-run wiring command: arms the test as a deterministic gate AFTER it is written. */
  proposeCommand: string;
}

export interface ScaffoldOptions {
  framework: TestFramework;
  /** Override the generated file path (project-relative). Wins over baseDir. */
  outPath?: string;
  /**
   * Repo-relative directory of the package that owns the incident (monorepo awareness). The default
   * test path and run command are placed inside it. Empty/omitted → repo root.
   */
  baseDir?: string;
  /**
   * Override the propose command embedded in the header and returned. Used by multi-package
   * scaffolds: a memory carries ONE sensor, so several generated tests share a single proposal
   * whose command chains every run command.
   */
  proposeCommandOverride?: string;
}

/** Map a user-supplied framework string (with common aliases) to a TestFramework, or null. */
export function normalizeFramework(input: string): TestFramework | null {
  const v = input.trim().toLowerCase();
  if (v === "vitest") return "vitest";
  if (v === "jest") return "jest";
  if (v === "pytest" || v === "py" || v === "python") return "pytest";
  if (v === "go" || v === "gotest" || v === "go-test") return "gotest";
  return null;
}

/**
 * Pure framework decision from already-gathered facts (a package.json's deps + non-JS signals). The
 * FS walking that produces these facts is I/O and lives in the caller (cli/mcp), keeping core pure.
 */
export function pickTestFramework(
  pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null,
  signals: { goMod?: boolean; pySignal?: boolean } = {},
): TestFramework {
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (deps.vitest) return "vitest";
  if (deps.jest || deps["ts-jest"]) return "jest";
  if (signals.goMod) return "gotest";
  if (signals.pySignal) return "pytest";
  return "vitest";
}

/** Join a repo-relative base dir with a default sub-path, tolerating an empty base and slashes. */
function joinRel(baseDir: string | undefined, rest: string): string {
  const base = (baseDir ?? "").replace(/^\/+|\/+$/g, "");
  return base ? `${base}/${rest}` : rest;
}

/** Strip the `YYYY-MM-DD-<type>-` id prefix to the descriptive slug (`importing-momentjs`). */
export function lessonShortName(memoryId: string): string {
  const stripped = memoryId.replace(
    /^\d{4}-\d{2}-\d{2}-(?:attempt|gotcha|decision|convention|architecture|glossary|skill|session_recap)-/,
    "",
  );
  const slug = (stripped || memoryId).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "incident";
}

function snake(slug: string): string {
  return slug.replace(/-/g, "_").replace(/[^a-z0-9_]/gi, "").replace(/^_+|_+$/g, "") || "incident";
}

function pascal(slug: string): string {
  return slug
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("") || "Incident";
}

/** Collapse a multi-line field to a single comment-safe line. */
function oneLine(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Parse the "what / why / instead" fields out of an attempt/gotcha memory body — the shape written
 * by `mem_tried` (`# <what>`, `**Why it failed / do NOT use:** …`, `**Instead, use:** …`). Pure so
 * the CLI can hand it a loaded body without re-implementing the parse.
 */
export function parseLessonFields(body: string): { title?: string; whyFailed?: string; instead?: string } {
  const title = body.match(/^#\s+(.+?)\s*$/m)?.[1]?.trim();
  const whyFailed = body.match(/\*\*Why it failed[^:]*:\*\*\s*([^\n]+)/i)?.[1]?.trim();
  const instead = body.match(/\*\*Instead,\s*use:\*\*\s*([^\n]+)/i)?.[1]?.trim();
  return { title, whyFailed, instead };
}

/**
 * Build the `sensors propose --kind test` line that arms a written post-incident test as the
 * lesson's oracle. Exported so multi-package scaffolds can chain several run commands into ONE
 * proposal (a memory carries a single sensor).
 */
export function buildProposeCommand(lesson: PostIncidentLesson, runCommand: string): string {
  const parts = [
    `hivelore sensors propose ${lesson.memoryId}`,
    "--kind test",
    `--command ${JSON.stringify(runCommand)}`,
  ];
  if (lesson.incident) parts.push(`--incident ${JSON.stringify(lesson.incident)}`);
  const scope = (lesson.paths ?? []).filter(Boolean);
  if (scope.length > 0) parts.push(`--paths ${JSON.stringify(scope.join(","))}`);
  return parts.join(" ");
}

function header(lesson: PostIncidentLesson, comment: (line: string) => string): string {
  const lines = [
    `Post-incident guard generated by Hivelore from ${lesson.memoryId}.`,
    ...(lesson.incident ? [`Incident: ${lesson.incident}`] : []),
    `What failed: ${oneLine(lesson.title)}`,
    ...(lesson.whyFailed ? [`Why: ${oneLine(lesson.whyFailed)}`] : []),
    ...(lesson.instead ? [`Expected / fix: ${oneLine(lesson.instead)}`] : []),
    "",
    "TODO: replace the pending test with a real check that FAILS on the incident and",
    "PASSES once the fix is in place. Then arm it as a deterministic gate:",
  ];
  return lines.map(comment).join("\n");
}

/** Build a scaffold for the given lesson + framework. Pure — the caller writes `content` to `relPath`. */
export function scaffoldPostIncidentTest(lesson: PostIncidentLesson, options: ScaffoldOptions): TestScaffold {
  const framework = options.framework;
  const short = lessonShortName(lesson.memoryId);
  const desc = oneLine(lesson.title) || short;
  const propose = (run: string): string => options.proposeCommandOverride ?? buildProposeCommand(lesson, run);

  let relPath: string;
  let runCommand: string;
  let content: string;

  if (framework === "vitest" || framework === "jest") {
    relPath = options.outPath ?? joinRel(options.baseDir, `tests/incidents/${short}.test.ts`);
    runCommand = framework === "vitest" ? `npx vitest run ${relPath}` : `npx jest ${relPath}`;
    const hc = (l: string) => (l ? `// ${l}` : "//");
    const importLine = framework === "vitest" ? `import { describe, it, expect } from "vitest";\n\n` : "";
    content =
      `${header(lesson, hc)}\n` +
      `//   ${propose(runCommand)}\n\n` +
      importLine +
      `describe(${JSON.stringify(desc)}, () => {\n` +
      `  it.todo("reproduces ${lesson.memoryId} and stays fixed");\n\n` +
      `  // it("guards the incident", () => {\n` +
      `  //   // Arrange the state that caused the incident, then assert the fixed behaviour.\n` +
      `  //   expect(subjectUnderTest()).toBe(/* expected */);\n` +
      `  // });\n` +
      `});\n`;
  } else if (framework === "pytest") {
    const fn = snake(short);
    relPath = options.outPath ?? joinRel(options.baseDir, `tests/incidents/test_${fn}.py`);
    runCommand = `pytest ${relPath}`;
    const hc = (l: string) => (l ? `# ${l}` : "#");
    content =
      `${header(lesson, hc)}\n` +
      `#   ${propose(runCommand)}\n\n` +
      `import pytest\n\n\n` +
      `@pytest.mark.skip(reason="TODO: write the post-incident assertion, then arm the sensor")\n` +
      `def test_${fn}():\n` +
      `    # Arrange the state that caused the incident, then assert the fixed behaviour.\n` +
      `    assert subject_under_test() == expected\n`;
  } else {
    // gotest
    const fn = pascal(short);
    const dir = options.outPath ? options.outPath.replace(/\/[^/]+$/, "") : joinRel(options.baseDir, "incidents");
    relPath = options.outPath ?? joinRel(options.baseDir, `incidents/incident_${snake(short)}_test.go`);
    runCommand = `go test ./${dir}/`;
    const hc = (l: string) => (l ? `// ${l}` : "//");
    content =
      `${header(lesson, hc)}\n` +
      `//   ${propose(runCommand)}\n\n` +
      `package incidents\n\n` +
      `import "testing"\n\n` +
      `func Test${fn}(t *testing.T) {\n` +
      `\tt.Skip("TODO: write the post-incident assertion, then arm the sensor")\n` +
      `\t// Arrange the state that caused the incident, then assert the fixed behaviour.\n` +
      `}\n`;
  }

  return { framework, relPath, content, runCommand, proposeCommand: propose(runCommand) };
}

// ── Scaffold-loop accounting: a pending scaffold that never becomes an armed oracle is an open loop ─

/** First-line provenance marker every generated scaffold carries. */
export const SCAFFOLD_MARKER_RE = /Post-incident guard generated by Hivelore from (\S+?)\.?\s*$/m;

/** Pending markers per framework — the stub shapes `scaffoldPostIncidentTest` writes. */
const PENDING_MARKERS = [/\bit\.todo\(/, /\bpytest\.mark\.skip\b/, /\bt\.Skip\(/];

export interface ScaffoldLoopGap {
  /** Memory id the scaffold was generated from (parsed from the provenance marker). */
  memory_id: string;
  /** Project-relative path of the scaffold file. */
  path: string;
  /** The stub is still pending (todo/skip) — the assertion was never written. */
  pending: boolean;
  /** The lesson carries a validated shell/test sensor — the oracle is routed to the gate. */
  armed: boolean;
  /** The referenced memory no longer exists (scaffold orphaned). */
  memory_missing: boolean;
}

/**
 * Cross-check written post-incident scaffolds against the corpus: a scaffold whose assertion is
 * still pending, or whose lesson has no armed command sensor, is an OPEN behaviour loop — the
 * incident is documented but nothing deterministic guards it yet. Pure: callers collect the files.
 * Returns only the gaps (closed loops are silent).
 */
export function assessScaffoldLoop(
  files: Array<{ path: string; content: string }>,
  memories: Array<{ id: string; sensorKind?: "regex" | "shell" | "test" | null }>,
): ScaffoldLoopGap[] {
  const byId = new Map(memories.map((m) => [m.id, m]));
  const gaps: ScaffoldLoopGap[] = [];
  for (const file of files) {
    const memoryId = file.content.match(SCAFFOLD_MARKER_RE)?.[1];
    if (!memoryId) continue;
    const memory = byId.get(memoryId);
    const pending = PENDING_MARKERS.some((re) => re.test(file.content));
    const armed = memory?.sensorKind === "shell" || memory?.sensorKind === "test";
    if (!pending && armed) continue; // loop closed — assertion written AND oracle routed
    gaps.push({
      memory_id: memoryId,
      path: file.path,
      pending,
      armed,
      memory_missing: memory === undefined,
    });
  }
  return gaps;
}
