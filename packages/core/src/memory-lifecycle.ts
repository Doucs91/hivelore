import type { MemoryFrontmatter } from "./types.js";

export interface RetirementSignal {
  retired: boolean;
  reason?: string;
}

const RETIRED_TAGS = new Set(["superseded", "obsolete", "archived"]);

const RETIRED_BODY_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bfixed\s+in\b[\s\S]{0,160}\b(audit|history|historical|obsolete|no longer applies)\b/i, reason: "body says this fixed record is audit/history only" },
  { re: /\bresolved\s+in\b/i, reason: "body says this was resolved" },
  { re: /\bsuperseded\s+by\b/i, reason: "body says this was superseded" },
  { re: /\bno\s+longer\s+(applies|true|valid)\b/i, reason: "body says this no longer applies" },
  { re: /\bobsolete\b/i, reason: "body says this is obsolete" },
];

/**
 * Explicit lifecycle gate for records that should not be fed back to agents as active policy.
 *
 * `status=deprecated/rejected/stale` is already the hard lifecycle signal. This helper covers
 * softer signals that teams naturally write while curating a corpus: an `expires_when` date,
 * a `superseded`/`obsolete` tag, or a short body note saying the attempt is now obsolete.
 *
 * Note: a plain `fixed` tag is intentionally NOT retired by itself. Many teams keep fixed
 * gotchas active as regression guards. To retire one, mark it deprecated, set expires_when,
 * use `obsolete`/`superseded`, or write that the fixed record is kept for audit/history only.
 */
export function retirementSignal(
  fm: MemoryFrontmatter,
  body = "",
  now: Date = new Date(),
): RetirementSignal {
  if (fm.status === "deprecated" || fm.status === "rejected" || fm.status === "stale") {
    return { retired: true, reason: `status=${fm.status}` };
  }

  if (fm.expires_when) {
    const expiresAt = Date.parse(fm.expires_when);
    if (Number.isFinite(expiresAt) && expiresAt <= now.getTime()) {
      return { retired: true, reason: `expired on ${fm.expires_when.slice(0, 10)}` };
    }
  }

  const retiredTag = fm.tags.find((tag) => RETIRED_TAGS.has(tag.toLowerCase()));
  if (retiredTag) {
    return { retired: true, reason: `tagged ${retiredTag}` };
  }

  for (const pattern of RETIRED_BODY_PATTERNS) {
    if (pattern.re.test(body)) return { retired: true, reason: pattern.reason };
  }

  return { retired: false };
}

export function isRetiredMemory(
  fm: MemoryFrontmatter,
  body = "",
  now: Date = new Date(),
): boolean {
  return retirementSignal(fm, body, now).retired;
}
