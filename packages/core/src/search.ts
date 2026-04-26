import type { Memory } from "./types.js";

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export function literalMatchesAllTokens(memory: Memory, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const fm = memory.frontmatter;
  const idLower = fm.id.toLowerCase();
  const tagsLower = fm.tags.map((t) => t.toLowerCase());
  const bodyLower = memory.body.toLowerCase();
  return tokens.every((rawTok) => {
    const tok = rawTok.toLowerCase();
    return (
      idLower.includes(tok) ||
      tagsLower.some((t) => t.includes(tok)) ||
      bodyLower.includes(tok)
    );
  });
}

export function pickSnippetNeedle(query: string): string {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return query.toLowerCase();
  return [...tokens].sort((a, b) => b.length - a.length)[0]!;
}

export function extractSnippet(body: string, needle: string, radius = 40): string {
  const lower = body.toLowerCase();
  const idx = needle ? lower.indexOf(needle) : -1;
  if (idx < 0) {
    return body.slice(0, radius * 3).replace(/\s+/g, " ").trim();
  }
  const start = Math.max(0, idx - radius);
  const end = Math.min(body.length, idx + needle.length + radius);
  const snippet = body.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + snippet + (end < body.length ? "…" : "");
}
