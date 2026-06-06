import path from "node:path";
import type { LoadedMemory } from "./loader.js";

/**
 * Tag stamped on memories that were pre-seeded from a stack pack at `haive init`
 * (generic framework knowledge the model already largely knows, not repo-specific
 * institutional knowledge). Briefing ranking caps these at `background` priority so
 * a generic seed never displaces a repo-specific memory — unless the seed has been
 * anchored to a file the agent is actually editing.
 */
export const STACK_PACK_TAG = "stack-pack";

/** True when a memory was pre-seeded from a stack pack (carries {@link STACK_PACK_TAG}). */
export function isStackPackSeed(fm: { tags?: string[] } | null | undefined): boolean {
  return Boolean(fm?.tags?.includes(STACK_PACK_TAG));
}

/**
 * Tags that mark a memory as a *local dev-environment workaround* (hot-swap, nested node_modules,
 * global-install quirks) rather than repo-specific team policy. These are real, but they describe
 * tooling debt, not unguessable team knowledge — and because they get read on almost every session
 * their read_count inflates and they crowd the briefing. Ranking caps them at `background` UNLESS
 * they directly anchor a file being edited, so they stop displacing actual policy. The fix for a
 * recurring one is to repair the environment, not to keep surfacing the note.
 */
export const ENV_WORKAROUND_TAGS = new Set([
  "dev-workflow",
  "dev-env",
  "hotswap",
  "local-setup",
  "tooling-debt",
]);

/** True when a memory is tagged as a local dev-environment workaround (see {@link ENV_WORKAROUND_TAGS}). */
export function isEnvWorkaroundMemory(fm: { tags?: string[] } | null | undefined): boolean {
  return Boolean(fm?.tags?.some((t) => ENV_WORKAROUND_TAGS.has(t)));
}

/**
 * Extract file-path references from prose (e.g. a project-context or recap body): tokens that contain
 * a `/` and end in a file extension, whether backtick-quoted or bare. Used to GROUND auto-generated
 * artifacts — a caller checks these against disk so a context that cites files which don't exist
 * (hallucinated / stale) can be flagged. Conservative on purpose (slash + extension) to avoid matching
 * domain terms. Pure.
 */
const PATH_REFERENCE_RE = /(?:^|[\s`'"(\[])((?:\.\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,8})(?=[\s`'".,;:)\]]|$)/gm;
export function extractReferencedPaths(text: string): string[] {
  const out = new Set<string>();
  for (const match of text.matchAll(PATH_REFERENCE_RE)) {
    const token = (match[1] ?? "").replace(/^\.\//, "").replace(/[.,;:]+$/, "");
    if (token) out.add(token);
  }
  return [...out];
}

/**
 * True when a memory carries any tag in `excludeTags` (case-insensitive) — used to keep
 * strategy/positioning memories OUT of automatic briefing surfacing while leaving them searchable.
 * See `HaiveConfig.briefingExcludeTags`. Empty/undefined list ⇒ never excluded.
 */
export function memoryHasExcludedTag(
  fm: { tags?: string[] } | null | undefined,
  excludeTags: string[] | null | undefined,
): boolean {
  if (!excludeTags || excludeTags.length === 0) return false;
  const lowered = new Set(excludeTags.map((t) => t.toLowerCase()));
  return Boolean(fm?.tags?.some((t) => lowered.has(t.toLowerCase())));
}

const MODULE_PATTERNS = [
  /^packages\/([^/]+)\//,
  /^apps\/([^/]+)\//,
  /^modules\/([^/]+)\//,
  /^src\/([^/]+)\//,
  /^libs\/([^/]+)\//,
  /^services\/([^/]+)\//,
  /^internal\/([^/]+)\//,
  /^projects\/([^/]+)\//,  // Nx layout
  /^cmd\/([^/]+)\//,       // Go-style
];

/**
 * Best-effort inference: given a list of file paths, infer module names from
 * conventional layouts (packages/X/, apps/X/, modules/X/, src/X/).
 */
export function inferModulesFromPaths(filePaths: string[]): string[] {
  const out = new Set<string>();
  for (const p of filePaths) {
    const norm = normalize(p);
    for (const re of MODULE_PATTERNS) {
      const m = norm.match(re);
      if (m && m[1]) out.add(m[1]);
    }
  }
  return [...out].sort();
}

/**
 * Path overlap: returns true if `a` and `b` refer to the same path or one is a
 * parent of the other. Both inputs are treated as POSIX-style relative paths.
 */
export function pathsOverlap(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (isGlobPath(na)) return globOverlapsPath(na, nb);
  if (isGlobPath(nb)) return globOverlapsPath(nb, na);
  if (na === nb) return true;
  return na.startsWith(nb + "/") || nb.startsWith(na + "/");
}

export function memoryMatchesAnchorPaths(
  memory: LoadedMemory["memory"],
  inputPaths: string[],
): boolean {
  const anchorPaths = memory.frontmatter.anchor.paths;
  if (anchorPaths.length === 0) return false;
  for (const ap of anchorPaths) {
    for (const ip of inputPaths) {
      if (pathsOverlap(ap, ip)) return true;
    }
  }
  return false;
}

function normalize(p: string): string {
  // Strip leading "./" and trailing "/", normalize separators.
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function isGlobPath(p: string): boolean {
  return /[*?\[]/.test(p);
}

export function globToRegExp(pattern: string): RegExp {
  const norm = normalize(pattern);
  let out = "^";
  for (let i = 0; i < norm.length; i++) {
    const ch = norm[i]!;
    const next = norm[i + 1];
    const afterNext = norm[i + 2];
    if (ch === "*" && next === "*" && afterNext === "/") {
      out += "(?:.*/)?";
      i += 2;
    } else if (ch === "*" && next === "*") {
      out += ".*";
      i++;
    } else if (ch === "*") {
      out += "[^/]*";
    } else if (ch === "?") {
      out += "[^/]";
    } else {
      out += ch.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
    }
  }
  out += "$";
  return new RegExp(out);
}

function globOverlapsPath(globPattern: string, candidate: string): boolean {
  const normalizedCandidate = normalize(candidate);
  if (globToRegExp(globPattern).test(normalizedCandidate)) return true;
  const prefix = globLiteralPrefix(globPattern);
  if (!prefix || prefix.split("/").length < 2) return false;
  return normalizedCandidate === prefix ||
    normalizedCandidate.startsWith(prefix + "/") ||
    prefix.startsWith(normalizedCandidate + "/");
}

function globLiteralPrefix(pattern: string): string {
  const norm = normalize(pattern);
  const firstGlob = norm.search(/[*?\[]/);
  if (firstGlob < 0) return norm;
  const slash = norm.slice(0, firstGlob).lastIndexOf("/");
  return slash < 0 ? "" : norm.slice(0, slash);
}

export function relPathFrom(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, "/");
}
