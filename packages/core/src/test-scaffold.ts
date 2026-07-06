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
  /**
   * Optional facts derived from the incident's fix diff (red_ref..HEAD). When present, the scaffold
   * names the actual symbols the fix touched and pre-fills the commented example around them, so the
   * human's "fill the assertion" step is a targeted edit rather than a blank page. Deterministic and
   * green-preserving: the enriched example stays commented (no live imports that might not resolve).
   */
  incidentHints?: IncidentHints;
}

/** Facts extracted from an incident's fix diff to make a scaffold concrete rather than generic. */
export interface IncidentHints {
  /** The pre-fix ref the hints were derived against (for provenance in the header). */
  redRef?: string;
  /** Files the fix changed (within the lesson's anchor scope). */
  changedFiles: string[];
  /** Symbols the fix added/changed (exported functions/consts/classes; def/func for py/go). */
  changedSymbols: string[];
}

/**
 * Extract the symbols and files a fix touched from its unified diff (`git diff red_ref..HEAD`).
 * Pure: the caller produces the diff (I/O). Scans ADDED lines for definitions across JS/TS, Python,
 * and Go — the frameworks the scaffolder targets — so the generated test can name the real subject.
 */
export function incidentHintsFromDiff(
  diff: string,
  opts: { redRef?: string; limitSymbols?: number } = {},
): IncidentHints {
  const changedFiles: string[] = [];
  // Two signal streams, priority order:
  //  - `touched`: a CONTAINER definition (function / class / def / func) whose hunk has a change. It
  //    is tracked from context AND added lines, so it names the symbol the fix changed even when only
  //    the body changed (git leaves the signature as an unchanged context line) — the common shape.
  //  - `valueAdded`: const/let/var definitions on ADDED lines. Secondary — catches new values but also
  //    incidental additions, so it ranks below the touched container.
  const touched: string[] = [];
  const valueAdded: string[] = [];
  // Container definitions (the subject of a behaviour fix). Match anywhere on the line.
  const CONTAINER_PATTERNS: RegExp[] = [
    /(?:^|\s)export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /(?:^|\s)export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/,
    /(?:^|\s)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
    /(?:^|\s)class\s+([A-Za-z_$][\w$]*)/,
    /(?:^|\s)def\s+([A-Za-z_][\w]*)\s*\(/,                 // python
    /(?:^|\s)func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)\s*\(/, // go (incl. methods)
  ];
  const VALUE_PATTERN = /(?:^|\s)export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
  const containerOf = (text: string): string | null => {
    for (const re of CONTAINER_PATTERNS) {
      const m = re.exec(text);
      if (m?.[1]) return m[1];
    }
    return null;
  };

  let enclosing: string | null = null; // current container symbol in scope within the hunk
  const markTouched = (sym: string | null): void => {
    if (sym && !touched.includes(sym)) touched.push(sym);
  };
  for (const raw of diff.split("\n")) {
    if (raw.startsWith("+++ ")) {
      const p = raw.slice(4).trim().replace(/^b\//, "");
      if (p && p !== "/dev/null") changedFiles.push(p);
      enclosing = null;
      continue;
    }
    if (raw.startsWith("@@")) {
      // A hunk heading may name the enclosing function when the signature is above the window.
      enclosing = containerOf(raw.replace(/^@@[^@]*@@/, ""));
      continue;
    }
    if (raw.startsWith("---")) continue;
    const isAdded = raw.startsWith("+");
    const isRemoved = raw.startsWith("-");
    const body = isAdded || isRemoved ? raw.slice(1) : raw.replace(/^ /, "");
    const container = containerOf(body);
    if (container) enclosing = container; // context or added definition → the symbol now in scope
    if (isAdded || isRemoved) {
      // A change inside the current container means the fix touched it.
      markTouched(enclosing);
      if (isAdded) {
        const value = VALUE_PATTERN.exec(body);
        if (value?.[1]) valueAdded.push(value[1]);
      }
    }
  }
  const limit = opts.limitSymbols ?? 6;
  const changedSymbols: string[] = [];
  const seen = new Set<string>();
  for (const sym of [...touched, ...valueAdded]) {
    if (seen.has(sym)) continue;
    seen.add(sym);
    changedSymbols.push(sym);
  }
  return {
    ...(opts.redRef ? { redRef: opts.redRef } : {}),
    changedFiles: [...new Set(changedFiles)],
    changedSymbols: changedSymbols.slice(0, limit),
  };
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
  const hints = lesson.incidentHints;
  const fixLines: string[] = [];
  if (hints && (hints.changedSymbols.length > 0 || hints.changedFiles.length > 0)) {
    const ref = hints.redRef ? ` (${hints.redRef}..HEAD)` : "";
    if (hints.changedSymbols.length > 0) {
      fixLines.push(`Fix${ref} touched: ${hints.changedSymbols.join(", ")}` +
        (hints.changedFiles.length > 0 ? ` in ${hints.changedFiles.slice(0, 3).join(", ")}` : "") + ".");
    } else {
      fixLines.push(`Fix${ref} touched: ${hints.changedFiles.slice(0, 3).join(", ")}.`);
    }
  }
  const lines = [
    `Post-incident guard generated by Hivelore from ${lesson.memoryId}.`,
    ...(lesson.incident ? [`Incident: ${lesson.incident}`] : []),
    `What failed: ${oneLine(lesson.title)}`,
    ...(lesson.whyFailed ? [`Why: ${oneLine(lesson.whyFailed)}`] : []),
    ...(lesson.instead ? [`Expected / fix: ${oneLine(lesson.instead)}`] : []),
    ...fixLines,
    "",
    "TODO: replace the pending test with a real check that FAILS on the incident and",
    "PASSES once the fix is in place. Then arm it as a deterministic gate:",
  ];
  return lines.map(comment).join("\n");
}

/**
 * The commented "suggested example" block. When the incident's fix diff named a subject symbol, the
 * example calls it by name (so the human fills a targeted assertion); otherwise the generic template.
 * Stays commented in every case — no live import that might not resolve, so the suite stays green.
 */
function exampleLines(lesson: PostIncidentLesson, lang: "js" | "py" | "go"): string[] {
  const symbol = lesson.incidentHints?.changedSymbols[0];
  const file = lesson.incidentHints?.changedFiles[0];
  if (lang === "js") {
    if (symbol) {
      return [
        `// it("guards the incident", () => {`,
        ...(file ? [`//   import { ${symbol} } from "${importSpecifier(file)}";  // adjust the relative path`] : []),
        `//   // Reproduce the incident input, then assert the behaviour the fix guarantees:`,
        `//   expect(${symbol}(/* incident input */)).toBe(/* post-fix expected */);`,
        `// });`,
      ];
    }
    return [
      `// it("guards the incident", () => {`,
      `//   // Arrange the state that caused the incident, then assert the fixed behaviour.`,
      `//   expect(subjectUnderTest()).toBe(/* expected */);`,
      `// });`,
    ];
  }
  if (lang === "py") {
    return symbol
      ? [
          `    # Reproduce the incident input, then assert what the fix guarantees:`,
          `    assert ${symbol}(...) == expected  # ${symbol} was changed by the fix`,
        ]
      : [
          `    # Arrange the state that caused the incident, then assert the fixed behaviour.`,
          `    assert subject_under_test() == expected`,
        ];
  }
  // go
  return symbol
    ? [`\t// Reproduce the incident input, then assert what the fix guarantees (subject: ${symbol}).`]
    : [`\t// Arrange the state that caused the incident, then assert the fixed behaviour.`];
}

/** Turn a source file path into an import specifier (drop the extension; keep it relative-looking). */
function importSpecifier(file: string): string {
  return file.replace(/\.[cm]?[jt]sx?$/, "");
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
      exampleLines(lesson, "js").map((l) => `  ${l}`).join("\n") + "\n" +
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
      exampleLines(lesson, "py").join("\n") + "\n";
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
      exampleLines(lesson, "go").join("\n") + "\n" +
      `}\n`;
  }

  return { framework, relPath, content, runCommand, proposeCommand: propose(runCommand) };
}

// ── Scaffold-loop accounting: a pending scaffold that never becomes an armed oracle is an open loop ─

/** First-line provenance marker every generated scaffold carries. */
export const SCAFFOLD_MARKER_RE = /Post-incident guard generated by Hivelore from (\S+?)\.?\s*$/m;

/** Pending markers per framework — the stub shapes `scaffoldPostIncidentTest` writes. */
const PENDING_MARKERS = [/\bit\.todo\(/, /\bpytest\.mark\.skip\b/, /\bt\.Skip\(/];

/** Does this test file still carry a pending stub (todo/skip)? A pending test passes on ANYTHING. */
export function hasPendingTestMarker(content: string): boolean {
  return PENDING_MARKERS.some((re) => re.test(content));
}

/**
 * Pull the test-file paths out of an oracle command (`npx vitest run a.test.ts && pytest b.py`).
 * Pure and deliberately conservative: only tokens that LOOK like test files are returned — the
 * caller checks existence. Used to refuse arming a still-pending oracle as a block sensor.
 */
export function extractTestFilePathsFromCommand(command: string): string[] {
  const TEST_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?|_test\.go|(^|\/)test_[\w.-]+\.py|\.(test|spec)\.py)$/;
  return command
    .split(/\s+/)
    .map((t) => t.replace(/^["']+|["']+$/g, ""))
    .filter((t) => t && !t.startsWith("-") && TEST_FILE_RE.test(t));
}

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
  memories: Array<{ id: string; sensorKind?: "regex" | "ast" | "shell" | "test" | null }>,
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
