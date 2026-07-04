/**
 * AST sensor adapter — the structural precision engine (excellence plan, Phase 1).
 *
 * A `kind: "ast"` sensor carries an ast-grep pattern instead of a regex: it matches the AST of
 * changed files, so comments and string literals can never false-positive and "X without Y" is
 * expressed structurally (`absent` = a sub-pattern that must NOT appear inside the match).
 *
 * REUSE over build: matching is delegated to the optional `@ast-grep/napi` engine (lazy-imported,
 * mirrors the @hivelore/embeddings optional-dependency pattern). Honesty rule when the engine is
 * missing: the sensor is UNRUNNABLE → warn, never block — same family as command sensors.
 *
 * Lives in mcp (not core) because loading a native module is I/O; imported by the CLI (cli→mcp).
 */
import path from "node:path";

export interface AstMatch {
  /** 1-indexed line range of the matched node. */
  startLine: number;
  endLine: number;
  /** Matched source text (trimmed, capped) for review output. */
  text: string;
}

export interface AstScanResult {
  status: "ok" | "engine-missing" | "unsupported-language" | "parse-error" | "invalid-pattern";
  matches: AstMatch[];
  detail?: string;
}

type NapiModule = typeof import("@ast-grep/napi");

let cachedEngine: NapiModule | null | undefined;

/** Lazy-load @ast-grep/napi once; null when the optional engine is not installed. */
export async function loadAstEngine(): Promise<NapiModule | null> {
  if (cachedEngine !== undefined) return cachedEngine;
  try {
    cachedEngine = await import("@ast-grep/napi");
  } catch {
    cachedEngine = null;
  }
  return cachedEngine;
}

export async function astEngineAvailable(): Promise<boolean> {
  return (await loadAstEngine()) !== null;
}

/** Map a file extension to a built-in ast-grep language. Unknown → null (unsupported, warn only). */
export function astLangForPath(filePath: string): "TypeScript" | "Tsx" | "JavaScript" | null {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") return "TypeScript";
  if (ext === ".tsx") return "Tsx";
  if (ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") return "JavaScript";
  return null;
}

/**
 * Is the `absent` companion present INSIDE a matched node? Structural sub-pattern first; when that
 * finds nothing, fall back to a regex (then plain substring) test on the node's own text — a
 * companion is often a property key (`idempotencyKey:`), which is a `property_identifier` node
 * that an identifier pattern cannot match structurally. The fallback stays scoped to the matched
 * node's text, so it cannot re-introduce file-wide false suppression.
 */
function absentPresentInNode(node: { find(p: string): unknown; text(): string }, absent: string): boolean {
  try {
    if (node.find(absent)) return true;
  } catch { /* not a valid sub-pattern — fall through to text test */ }
  const text = node.text();
  try {
    return new RegExp(absent).test(text);
  } catch {
    return text.includes(absent);
  }
}

/**
 * Run one AST pattern (with optional `absent` sub-pattern) over a file's FULL content.
 * A match is suppressed when `absent` matches INSIDE the matched node — the structural version of
 * the regex `absent` window: the required companion lives in the call's own arguments.
 */
export async function runAstPattern(
  content: string,
  filePath: string,
  pattern: string,
  absent?: string,
): Promise<AstScanResult> {
  const engine = await loadAstEngine();
  if (!engine) return { status: "engine-missing", matches: [] };
  const langName = astLangForPath(filePath);
  if (!langName) return { status: "unsupported-language", matches: [] };
  const lang = engine.Lang[langName];
  let root;
  try {
    root = engine.parse(lang, content).root();
  } catch (err) {
    return { status: "parse-error", matches: [], detail: String(err).slice(0, 200) };
  }
  let nodes;
  try {
    nodes = root.findAll(pattern);
  } catch (err) {
    return { status: "invalid-pattern", matches: [], detail: String(err).slice(0, 200) };
  }
  const matches: AstMatch[] = [];
  for (const node of nodes) {
    if (absent && absentPresentInNode(node, absent)) continue; // companion present — legitimate use
    const range = node.range();
    matches.push({
      startLine: range.start.line + 1,
      endLine: range.end.line + 1,
      text: node.text().trim().slice(0, 200),
    });
  }
  return { status: "ok", matches };
}

/**
 * Gate-side evaluation: matches on the full content, FIRES only when a match intersects the added
 * lines (introduction, not mere presence). `addedLines` empty/undefined = validation mode (any
 * match counts — used for silent-on-current / fires-on-bad checks).
 */
export async function runAstSensorOnContent(
  input: {
    pattern: string;
    absent?: string;
    content: string;
    filePath: string;
    addedLines?: Set<number>;
  },
): Promise<AstScanResult> {
  const scan = await runAstPattern(input.content, input.filePath, input.pattern, input.absent);
  if (scan.status !== "ok" || !input.addedLines || input.addedLines.size === 0) return scan;
  const added = input.addedLines;
  return {
    status: "ok",
    matches: scan.matches.filter((m) => {
      for (let line = m.startLine; line <= m.endLine; line++) {
        if (added.has(line)) return true;
      }
      return false;
    }),
  };
}
