/**
 * One actionable line per memory.
 *
 * Every agent-facing surface (edit-time reminder, briefing, bridge) used to show either the whole
 * body or a head-first cut of it. Decision memories are written context → reason → instruction, so
 * the cut kept the context and dropped the instruction — one ended exactly on its "What is in
 * place:" header (field report #11 §5) — and the edit-time hook delivered only "Full instruction NOT
 * delivered. Read the source" (~100% of 712 reminders measured in field report #12 §1.1).
 *
 * Precedence: the explicit `rule` frontmatter field, then an instruction-shaped line in the body
 * ("Instead…", "Rule:", "How to apply", "Fix"), then the first substantive sentence.
 */
import type { Memory } from "./types.js";

const MAX_RULE_CHARS = 240;

const INSTRUCTION_LINE =
  /^\s*(?:[-*+]\s*)?(?:\*\*)?(?:rule|instead(?:,? use| do)?|do instead|use instead|how to apply|fix|the fix|recommended|correct approach|do this|always|never)(?:\*\*)?\s*[:—–-]\s*(.+)$/i;
const INSTRUCTION_HEADING =
  /^#{1,6}\s+(?:rule|instead|how to apply|fix|the fix|recommended|correct approach|do this|what to do)\b/i;

function clean(line: string): string {
  return line
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string): string {
  if (text.length <= MAX_RULE_CHARS) return text;
  const cut = text.slice(0, MAX_RULE_CHARS);
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("; "));
  return (sentenceEnd > 80 ? cut.slice(0, sentenceEnd + 1) : cut.trimEnd()) + (sentenceEnd > 80 ? "" : "…");
}

function firstSentence(paragraph: string): string {
  const match = paragraph.match(/^(.+?[.!?])(?:\s|$)/);
  return match ? match[1]! : paragraph;
}

/** Derive the rule line from a body when no explicit `rule` is set. Pure. */
export function deriveRuleLine(body: string): string {
  const lines = body.replace(/\r/g, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const inline = line.match(INSTRUCTION_LINE);
    if (inline?.[1] && clean(inline[1]).length >= 8) return clip(clean(inline[1]));
    if (INSTRUCTION_HEADING.test(line.trim())) {
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j]!.trim();
        if (!next) continue;
        if (next.startsWith("#")) break;
        return clip(clean(next));
      }
    }
  }
  // First substantive paragraph (skip headings, code fences, tables and front-loaded metadata).
  let inFence = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) { inFence = !inFence; continue; }
    if (inFence || !line || line.startsWith("#") || line.startsWith("|") || line.startsWith(">")) continue;
    const text = clean(line);
    if (text.length < 12) continue;
    return clip(firstSentence(text));
  }
  return "";
}

/** The single line an agent should act on for this memory. */
export function memoryRuleLine(memory: Pick<Memory, "frontmatter" | "body">): string {
  const explicit = memory.frontmatter.rule?.trim();
  if (explicit) return clip(explicit.replace(/\s+/g, " "));
  return deriveRuleLine(memory.body);
}
