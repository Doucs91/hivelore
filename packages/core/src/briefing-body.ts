/**
 * Strip memory markdown down to actionable bullet lines — cheaper for briefing payloads.
 */

const MAX_DEFAULT_CHARS = 1200;

/**
 * Prefer markdown list lines; fall back to the first substantive paragraph block.
 */
export function extractActionsBriefBody(markdown: string, maxChars = MAX_DEFAULT_CHARS): string {
  const stripped = markdown.replace(/\r/g, "").trim();
  if (!stripped) return "";

  const lines = stripped.split("\n");
  const bullets: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*[-*+]\s+(.+)/);
    if (m?.[1]) {
      bullets.push(`- ${m[1].trim()}`);
      if (bullets.join("\n").length >= maxChars) break;
    }
  }
  if (bullets.length >= 2) {
    let text = bullets.join("\n");
    if (text.length > maxChars) text = text.slice(0, maxChars).trimEnd() + "…";
    return text;
  }

  // Single bullet or none — take contiguous non-empty paragraphs (skip headings)
  const paragraphs: string[] = [];
  let buf: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      if (buf.length) {
        paragraphs.push(buf.join(" ").trim());
        buf = [];
      }
      continue;
    }
    if (t.startsWith("#") || t.startsWith("```")) {
      if (buf.length) {
        paragraphs.push(buf.join(" ").trim());
        buf = [];
      }
      continue;
    }
    buf.push(t);
  }
  if (buf.length) paragraphs.push(buf.join(" ").trim());

  let out = paragraphs[0] ?? stripped.slice(0, maxChars);
  if (!out.trim()) out = stripped.slice(0, maxChars);
  if (out.length > maxChars) out = out.slice(0, maxChars).trimEnd() + "…";
  return out;
}
