/**
 * Docs-aware caveats — let the repo's own documentation speak up at the edit it is about.
 *
 * Field report #9 §1: a doc in the repo said, in plain words, "enforcing policy X would break
 * component Y". X was enforced a week later; the briefing surfaced the decision memory but not the
 * doc, and the failure lived in production for a week. Field report #11 §9: durable knowledge is
 * written in `docs/` (reviewed in the PR, read by humans) and SHOULD stay there — a memory that
 * copies a doc drifts from it. So Hivelore reads the docs instead of asking anyone to copy them.
 *
 * Deterministic and precision-first:
 *   - a doc paragraph is relevant when it names a target — the edited file's path (or a ≥2-segment
 *     suffix of it, or a distinctive basename), a requested symbol, or a config key the edit touches —
 *     or when it sits under a heading that names one;
 *   - it is a CAVEAT when the paragraph carries warning language ("would break", "never", "only
 *     works", "known issue", an admonition…). Caveats are delivered as text; plain mentions only as
 *     pointers ("also documented in docs/x.md:12");
 *   - config keys (tokens lifted from the edit itself) only ever produce caveats, never mentions —
 *     a key is too common to justify a pointer on its own.
 *
 * {@link findDocCaveats} is pure; {@link loadDocFiles} is the bounded I/O helper (tracked files only:
 * an untracked note is not team truth).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface DocFile {
  /** Project-relative, forward slashes. */
  path: string;
  content: string;
}

export interface DocTargets {
  /** Project-relative files being edited (or passed to the briefing). */
  files: string[];
  /** Symbol names (classes, functions, env vars…). */
  symbols?: string[];
  /** Distinctive tokens taken from the edit itself (config keys, directives). Caveats only. */
  keys?: string[];
}

export interface DocCaveat {
  /** Project-relative doc path. */
  doc: string;
  /** 1-based line of the paragraph's first line. */
  line: number;
  heading?: string;
  /** The paragraph, whitespace-collapsed and clipped around the mention. */
  text: string;
  /** The target (file, symbol or key) the paragraph names. */
  target: string;
  /** How it matched: the path itself, a path suffix, the basename, a symbol, a key, or a heading. */
  via: "path" | "path-suffix" | "basename" | "symbol" | "key" | "heading";
}

export interface DocMention {
  doc: string;
  line: number;
  target: string;
}

export interface DocCaveatsResult {
  caveats: DocCaveat[];
  /** Docs that mention a target without warning language — pointers only. */
  mentions: DocMention[];
}

export interface DocCaveatOptions {
  /** Max caveats returned (default 4). */
  limit?: number;
  /** Max mention pointers returned (default 3). */
  mentionLimit?: number;
  /** Clip each caveat to this many characters (default 280). */
  maxChars?: number;
}

const DOC_EXTENSIONS = new Set(["md", "mdx", "markdown", "rst", "adoc", "txt"]);
const DOC_DIRS = new Set(["docs", "doc", "documentation", "adr", "adrs", "decisions", "runbooks", "wiki"]);
/** Files that are logs, generated bridges or legal text — never a caveat source. */
const EXCLUDED_BASENAMES = /^(?:changelog|changes|history|releases?|claude|agents|gemini|license|licence|copying|notice|code_of_conduct|next)(?:\.[a-z]+)?$/i;
const EXCLUDED_PREFIXES = [".ai/", ".github/", ".cursor/", ".claude/", ".windsurf/", ".clinerules", "node_modules/", ".git/"];

/** Which repo files count as documentation for caveat retrieval. */
export function isDocCandidatePath(rawPath: string): boolean {
  const p = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
  if (EXCLUDED_PREFIXES.some((prefix) => p.startsWith(prefix)) || p.includes("/node_modules/")) return false;
  const segments = p.split("/");
  const base = segments[segments.length - 1] ?? "";
  const dot = base.lastIndexOf(".");
  const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
  if (!DOC_EXTENSIONS.has(ext)) return false;
  if (EXCLUDED_BASENAMES.test(base)) return false;
  if (/^readme(?:\.[a-z-]+)*$/i.test(base)) return true;
  if (segments.slice(0, -1).some((s) => DOC_DIRS.has(s.toLowerCase()))) return true;
  // Root-level prose (ARCHITECTURE.md, SECURITY.md, RUNBOOK.md…), but not root .txt noise.
  return segments.length === 1 && ext !== "txt";
}

/** Basenames too common to identify one file on their own. */
const GENERIC_STEMS = new Set([
  "index", "main", "app", "utils", "util", "types", "type", "config", "configuration", "settings",
  "readme", "package", "tsconfig", "mod", "lib", "init", "setup", "test", "tests", "spec", "helpers",
  "helper", "constants", "common", "core", "base", "default", "server", "client", "api", "routes",
  "schema", "models", "model", "service", "controller", "style", "styles", "global", "globals", "env",
  "dockerfile", "makefile", "build", "vite", "webpack", "jest", "vitest", "eslint", "prettier",
]);

// Phrasings that WARN, not words that describe: "failure", "risk" or "regression" appear in every
// spec that merely talks about them, so they only count inside a warning construction.
const CAVEAT_LANGUAGE =
  /\b(?:warning|caution|caveat|careful|beware|(?:will|would|could|may|can) (?:break|fail|corrupt|lose)|breaks|breakage|must(?!-have)|mustn'?t|should not|ne doit (?:pas|jamais)|doit toujours|only works|does(?: not|n'?t) work|fails? (?:when|on|if|with|silently|in production)|gotcha|pitfalls?|known (?:issue|limitation|bug)s?|danger(?:ous)?|risky|incompatible|side[- ]effects?|il ne faut (?:pas|jamais)|à ne (?:pas|jamais)|interdit|cassera(?:it)?|casserait|échouera(?:it)?)\b|\battention\s*:/i;
// "never" / "jamais" / "ne pas" are instructions only when they OPEN a sentence or list item
// ("Never reload during a release", "Ne jamais modifier…"); mid-sentence they narrate ("were never
// read", "sans jamais figurer") — dogfooding on this repo's French field reports showed the noise.
const IMPERATIVE_START = /^(?:never|do not|don'?t|avoid|ne (?:jamais|pas)|n'(?:utilisez|modifiez|ajoutez|supprimez)|évite[rz]?)\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;:])\s+|\s+[-*•]\s+/)
    .map((s) => s.replace(/^[\s>*_`#|-]+|^\d+[.)]\s*/g, "").replace(/^\*\*|^_+/, "").trim())
    .filter(Boolean);
}
const ADMONITION = /^\s*(?:>\s*)?(?:\[!(?:warning|caution|important|danger)\]|:::\s*(?:warning|danger|caution|important)|⚠️?|🚨|\*\*(?:warning|caution|important|attention)\b)/i;

/** True when a paragraph reads as a warning, not a description. */
export function hasCaveatLanguage(text: string): boolean {
  return CAVEAT_LANGUAGE.test(text) || ADMONITION.test(text) || sentences(text).some((s) => IMPERATIVE_START.test(s));
}

interface Term {
  text: string;
  target: string;
  via: DocCaveat["via"];
  /** Higher = more specific. */
  weight: number;
  caseSensitive: boolean;
  caveatOnly: boolean;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termsFor(targets: DocTargets): Term[] {
  const terms: Term[] = [];
  const seen = new Set<string>();
  const add = (term: Term): void => {
    const key = term.caseSensitive ? term.text : term.text.toLowerCase();
    if (seen.has(key) || term.text.length < 3) return;
    seen.add(key);
    terms.push(term);
  };
  for (const raw of targets.files) {
    const file = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    if (!file) continue;
    add({ text: file, target: file, via: "path", weight: 5, caseSensitive: true, caveatOnly: false });
    const segments = file.split("/");
    // Docs often drop the monorepo prefix: frontend/src/security/csp.ts is written src/security/csp.ts.
    for (let i = 1; i <= segments.length - 2; i++) {
      add({ text: segments.slice(i).join("/"), target: file, via: "path-suffix", weight: 4, caseSensitive: true, caveatOnly: false });
    }
    const base = segments[segments.length - 1]!;
    const stem = base.replace(/\.[^.]+$/, "");
    if (base.includes(".") && stem.length >= 5 && !GENERIC_STEMS.has(stem.toLowerCase())) {
      add({ text: base, target: file, via: "basename", weight: 3, caseSensitive: true, caveatOnly: false });
    }
  }
  for (const symbol of targets.symbols ?? []) {
    const s = symbol.trim();
    if (s.length >= 4 && !GENERIC_STEMS.has(s.toLowerCase())) {
      add({ text: s, target: s, via: "symbol", weight: 3, caseSensitive: true, caveatOnly: false });
    }
  }
  for (const key of targets.keys ?? []) {
    const k = key.trim();
    if (k.length >= 4) add({ text: k, target: k, via: "key", weight: 2, caseSensitive: true, caveatOnly: true });
  }
  return terms;
}

function termRegExp(term: Term): RegExp {
  // Boundaries that respect paths and dashed keys: "csp.ts" must not match "nocsp.tsx".
  return new RegExp(`(?<![\\w./-])${escapeRegExp(term.text)}(?![\\w-]|\\.\\w)`, term.caseSensitive ? "" : "i");
}

interface Paragraph {
  line: number;
  text: string;
  heading?: string;
  headingTerms: Term[];
}

function splitParagraphs(content: string, terms: Array<{ term: Term; re: RegExp }>): Paragraph[] {
  const lines = content.replace(/\r/g, "").split("\n");
  const out: Paragraph[] = [];
  let inFence = false;
  let heading: string | undefined;
  let headingTerms: Term[] = [];
  let buf: string[] = [];
  let start = 0;
  const flush = (): void => {
    if (buf.length) out.push({ line: start + 1, text: buf.join(" "), heading, headingTerms });
    buf = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (/^(?:```|~~~)/.test(trimmed)) { flush(); inFence = !inFence; continue; }
    if (inFence) continue;
    const headingMatch = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmed);
    if (headingMatch) {
      flush();
      heading = headingMatch[2]!.replace(/[`*_]/g, "").trim();
      headingTerms = terms.filter(({ term, re }) => !term.caveatOnly && re.test(headingMatch[2]!)).map(({ term }) => term);
      continue;
    }
    if (!trimmed) { flush(); continue; }
    // Each table row and each list item is its own unit: a long list must not merge into one blob.
    const startsUnit = trimmed.startsWith("|") || /^(?:[-*+]|\d+[.)])\s/.test(trimmed);
    if (startsUnit) flush();
    if (buf.length === 0) start = i;
    buf.push(trimmed);
    if (trimmed.startsWith("|")) flush();
    if (buf.length >= 8) flush();
  }
  flush();
  return out;
}

function backtickedSpans(text: string): string[] {
  return [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
}

function clipAround(text: string, needle: string | undefined, maxChars: number): string {
  const clean = text
    .replace(/^\s*(?:>\s*)+/, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (clean.length <= maxChars) return clean;
  const at = needle ? clean.indexOf(needle) : -1;
  if (at < 0) return `${clean.slice(0, maxChars - 1).trimEnd()}…`;
  const startAt = Math.max(0, Math.min(at - Math.floor(maxChars / 3), clean.length - maxChars));
  const slice = clean.slice(startAt, startAt + maxChars - 2).trim();
  return `${startAt > 0 ? "…" : ""}${slice}${startAt + maxChars - 2 < clean.length ? "…" : ""}`;
}

/** Find the doc paragraphs that warn about (or merely mention) the targets. Pure. */
export function findDocCaveats(docs: DocFile[], targets: DocTargets, opts: DocCaveatOptions = {}): DocCaveatsResult {
  const limit = opts.limit ?? 4;
  const mentionLimit = opts.mentionLimit ?? 3;
  const maxChars = opts.maxChars ?? 280;
  const terms = termsFor(targets).map((term) => ({ term, re: termRegExp(term) }));
  if (terms.length === 0) return { caveats: [], mentions: [] };
  const targetFiles = new Set(targets.files.map((f) => f.replace(/\\/g, "/").replace(/^\.\//, "")));

  const scored: Array<DocCaveat & { score: number }> = [];
  const mentions: Array<DocMention & { score: number }> = [];
  for (const doc of docs) {
    // A doc never warns about itself.
    if (targetFiles.has(doc.path)) continue;
    // Cheap pre-filter: skip docs that contain none of the terms at all.
    if (!terms.some(({ term }) => doc.content.includes(term.text))) continue;
    let headingCaveatsInSection = 0;
    let lastHeading: string | undefined;
    for (const para of splitParagraphs(doc.content, terms)) {
      if (para.heading !== lastHeading) { lastHeading = para.heading; headingCaveatsInSection = 0; }
      const caveat = hasCaveatLanguage(para.text);
      let best: { term: Term } | undefined;
      for (const entry of terms) {
        if (entry.term.caveatOnly && !caveat) continue;
        if (!entry.re.test(para.text)) continue;
        // A config key counts only where the doc cites it as code: "`worker-src`" names the directive,
        // "a read-only mount" is just English that happens to share the token.
        if (entry.term.via === "key" && !backtickedSpans(para.text).some((span) => entry.re.test(span))) continue;
        if (!best || entry.term.weight > best.term.weight) best = entry;
      }
      if (best) {
        if (caveat) {
          scored.push({
            doc: doc.path, line: para.line, ...(para.heading ? { heading: para.heading } : {}),
            text: clipAround(para.text, best.term.text, maxChars),
            target: best.term.target, via: best.term.via,
            score: 10 + best.term.weight,
          });
        } else {
          mentions.push({ doc: doc.path, line: para.line, target: best.term.target, score: best.term.weight });
        }
        continue;
      }
      // A section titled after the file: its warnings are about the file even when they don't name it.
      if (caveat && para.headingTerms.length > 0 && headingCaveatsInSection < 2) {
        headingCaveatsInSection++;
        const term = para.headingTerms.reduce((a, b) => (b.weight > a.weight ? b : a));
        scored.push({
          doc: doc.path, line: para.line, ...(para.heading ? { heading: para.heading } : {}),
          text: clipAround(para.text, undefined, maxChars),
          target: term.target, via: "heading",
          score: 8 + term.weight,
        });
      }
    }
  }

  scored.sort((a, b) => b.score - a.score || a.doc.localeCompare(b.doc) || a.line - b.line);
  const caveats: DocCaveat[] = [];
  const seenText = new Set<string>();
  for (const item of scored) {
    if (caveats.length >= limit) break;
    if (seenText.has(item.text)) continue;
    seenText.add(item.text);
    const { score: _score, ...rest } = item;
    void _score;
    caveats.push(rest);
  }
  const caveatDocs = new Set(caveats.map((c) => c.doc));
  mentions.sort((a, b) => b.score - a.score || a.doc.localeCompare(b.doc) || a.line - b.line);
  const pointerDocs = new Set<string>();
  const pointers: DocMention[] = [];
  for (const m of mentions) {
    if (pointers.length >= mentionLimit) break;
    if (caveatDocs.has(m.doc) || pointerDocs.has(m.doc)) continue;
    pointerDocs.add(m.doc);
    pointers.push({ doc: m.doc, line: m.line, target: m.target });
  }
  return { caveats, mentions: pointers };
}

const EDIT_KEY_STOPWORDS = new Set([
  "const", "function", "return", "import", "export", "default", "async", "await", "string", "number",
  "boolean", "undefined", "null", "true", "false", "class", "interface", "public", "private", "static",
  "final", "void", "this", "self", "None", "else", "elif", "while", "break", "continue", "throw", "catch",
  "finally", "typeof", "instanceof", "readonly", "override", "extends", "implements", "package", "module",
  "require", "console", "length", "value", "values", "items", "index", "error", "result", "options",
]);

/**
 * Distinctive tokens from an edit's text — the config keys and identifiers a doc would name
 * ("worker-src", "Content-Security-Policy", "spring.jpa.open-in-view", "STRIPE_WEBHOOK_SECRET").
 * Only compound tokens qualify (dash, underscore, dot or inner capital): plain words are prose.
 */
export function distinctiveEditTokens(text: string, max = 16): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z][A-Za-z0-9]*(?:[-_.][A-Za-z0-9]+)+|[a-z]+[A-Z][A-Za-z0-9]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*/g)) {
    const token = match[0]!.replace(/[.]+$/, "");
    if (token.length < 5 || token.length > 60 || EDIT_KEY_STOPWORDS.has(token) || seen.has(token)) continue;
    // Skip file-ish tokens (handled by path terms) and version-ish strings.
    if (/\.(?:ts|tsx|js|jsx|mjs|cjs|json|md|java|kt|py|go|rs|rb|php|css|scss|html|ya?ml|toml)$/i.test(token)) continue;
    if (/^v?\d/.test(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

export const DOC_CORPUS_LIMITS = {
  maxFiles: 400,
  maxBytesPerFile: 256 * 1024,
  maxTotalBytes: 4 * 1024 * 1024,
};

/**
 * Read the repo's tracked documentation, bounded. Uses `git ls-files` so untracked notes and
 * ignored output never count; falls back to a shallow walk of the doc directories outside git.
 */
export function loadDocFiles(root: string, limits = DOC_CORPUS_LIMITS): DocFile[] {
  let candidates: string[] = [];
  try {
    const out = execFileSync("git", ["ls-files", "-z", "--", "*.md", "*.mdx", "*.markdown", "*.rst", "*.adoc", "*.txt"], {
      cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024, timeout: 5000,
    });
    candidates = out.split("\0").filter(Boolean);
  } catch {
    candidates = walkDocDirs(root);
  }
  const docs: DocFile[] = [];
  let total = 0;
  // Doc directories first, READMEs after: a long monorepo README list must not crowd out docs/.
  candidates = candidates.filter(isDocCandidatePath).sort((a, b) => docRank(a) - docRank(b) || a.localeCompare(b));
  for (const rel of candidates) {
    if (docs.length >= limits.maxFiles || total >= limits.maxTotalBytes) break;
    const abs = path.join(root, rel);
    try {
      const size = statSync(abs).size;
      if (size > limits.maxBytesPerFile || size === 0) continue;
      const content = readFileSync(abs, "utf8");
      total += size;
      docs.push({ path: rel.replace(/\\/g, "/"), content });
    } catch {
      // deleted in the working tree, unreadable — skip
    }
  }
  return docs;
}

function docRank(p: string): number {
  const first = p.split("/")[0]!.toLowerCase();
  if (DOC_DIRS.has(first)) return 0;
  if (!p.includes("/")) return 1;
  return 2;
}

function walkDocDirs(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number): void => {
    if (depth > 4 || out.length > 2000) return;
    let entries: import("node:fs").Dirent[];
    try { entries = readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const rel = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth === 0 && !DOC_DIRS.has(entry.name.toLowerCase())) continue;
        visit(rel, depth + 1);
      } else {
        out.push(rel);
      }
    }
  };
  if (existsSync(root)) visit("", 0);
  return out;
}

/** One-line rendering for hooks and the CLI briefing. */
export function renderDocCaveat(caveat: DocCaveat): string {
  return `${caveat.doc}:${caveat.line}${caveat.heading ? ` (${caveat.heading})` : ""} — ${caveat.text}`;
}
