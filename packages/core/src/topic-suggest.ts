import type { MemoryType } from "./types.js";

const TYPE_TO_FAMILY: Partial<Record<MemoryType, string>> = {
  architecture: "architecture",
  convention: "pattern",
  decision: "decision",
  gotcha: "bug",
  attempt: "bug",
  glossary: "discovery",
  skill: "skill",
  session_recap: "session",
};

function slugifyTitle(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s.length > 0 ? s.slice(0, 60) : "untitled";
}

/**
 * Suggest a stable `topic` frontmatter key (topic-upsert) from type + title.
 */
export function suggestTopicKey(
  type: string,
  titleOrPhrase: string,
): { topic_key: string; family: string } {
  const family = TYPE_TO_FAMILY[type as MemoryType] ?? "discovery";
  const slug = slugifyTitle(titleOrPhrase);
  return { topic_key: `${family}/${slug}`, family };
}
