/**
 * Cold-start seeding from git history — the harness has value only once the corpus is populated,
 * and a fresh repo starts empty (Fowler's "harnessability": greenfield is easy, legacy is hard).
 *
 * Reverts and fixups are the cheapest signal of a real, repo-specific mistake: a commit that had to
 * be undone or hot-fixed encodes a lesson the team already paid for. This module parses a list of
 * commits (the CLI runs `git log`) and proposes DRAFT `attempt` seeds — never validated, always
 * human-reviewed. Pure: the caller does the git I/O and the memory writes.
 */

export interface GitCommit {
  sha: string;
  subject: string;
  /** Files touched by the commit (optional — improves anchoring). */
  files?: string[];
}

export interface SeedProposal {
  /** Kebab-ish slug derived from the reverted subject. */
  slug: string;
  /** What was tried (the thing that had to be reverted/fixed). */
  what: string;
  /** Why it failed (inferred from the revert/fixup). */
  why_failed: string;
  /** Suggested anchor paths (from the commit's files). */
  paths: string[];
  /** The source commit, for provenance. */
  source_sha: string;
  /** Detected signal kind. */
  kind: "revert" | "fixup" | "workaround";
}

const REVERT_RE = /^Revert\s+"(.+)"\s*$/i;
const FIXUP_RE = /^(?:fixup!|hotfix[:!]|fix[:!]\s*revert|revert\s+revert)/i;
const URGENT_FIX_RE = /\b(hotfix|urgent fix|emergency fix|critical fix|broke production|broken build)\b/i;
// A commit that admits a stop-gap encodes a known trap: the "right" fix is still owed.
// The leading `(?<![\w-])` stops compound *nouns* (a feature literally named "env-workaround",
// "X-workaround") from being mistaken for an admission of bricolage — that produced a meaningless
// seed for `chore: apply env-workaround down-rank to corpus`. FIXME/XXX are deliberately excluded:
// they belong in code, not commit subjects, where they were pure noise.
const WORKAROUND_RE = /(?<![\w-])(?:work[\s-]?around|band[\s-]?aid|temporary fix|temp fix|quick[\s-]?fix|kludge|monkey[\s-]?patch|stop[\s-]?gap)(?![\w-])|\bhack(?:y|ish)?\b/i;

function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "reverted-change"
  );
}

/**
 * Turn commits into seed proposals. A `Revert "X"` commit proposes an attempt about X; an obvious
 * hotfix/fixup commit proposes an attempt about the fixed area. Deduped by slug. Pure.
 */
export function proposeSeedsFromCommits(
  commits: GitCommit[],
  limit = 20,
): SeedProposal[] {
  const out: SeedProposal[] = [];
  const seen = new Set<string>();

  for (const commit of commits) {
    const subject = commit.subject.trim();
    let what: string | null = null;
    let kind: SeedProposal["kind"] | null = null;

    const revert = subject.match(REVERT_RE);
    if (revert) {
      what = revert[1]!.trim();
      kind = "revert";
    } else if (FIXUP_RE.test(subject) || URGENT_FIX_RE.test(subject)) {
      what = subject.replace(FIXUP_RE, "").trim() || subject;
      kind = "fixup";
    } else if (WORKAROUND_RE.test(subject)) {
      what = subject;
      kind = "workaround";
    }

    if (!what || !kind) continue;
    const slug = slugify(what);
    if (seen.has(slug)) continue;
    seen.add(slug);

    out.push({
      slug,
      what,
      why_failed:
        kind === "revert"
          ? `This change was reverted in commit ${commit.sha} — it caused a regression and was backed out. Verify the root cause before re-attempting.`
          : kind === "workaround"
          ? `This area carries a known workaround/stop-gap (commit ${commit.sha}: "${subject}") — the proper fix is still owed. Understand why the workaround exists before changing it.`
          : `This area required an urgent fix (commit ${commit.sha}: "${subject}") — it shipped broken once. Treat changes here with extra care.`,
      paths: (commit.files ?? []).slice(0, 8),
      source_sha: commit.sha,
      kind,
    });
    if (out.length >= limit) break;
  }

  return out;
}
