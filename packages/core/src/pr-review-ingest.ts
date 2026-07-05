/**
 * PR review-thread ingestion (excellence plan, Phase 3) — the git-native version of CodeRabbit's
 * "Learnings": a human reviewer's reply on a PR thread becomes a PROPOSED memory anchored to the
 * file the thread points at. Where CodeRabbit's learning stays inferential review context forever,
 * a Hivelore review learning can graduate into a deterministic sensor.
 *
 * Pure: callers fetch the GitHub review-comments JSON (`gh api repos/:o/:r/pulls/:n/comments`)
 * or hand in a recorded payload; this module only filters and templates. Deterministic — the
 * instruction filter is a shape heuristic plus an explicit `hivelore:` marker, never an LLM.
 */
import { buildFrontmatter } from "./parser.js";
import type { Finding, MemoryDraft } from "./findings.js";

export interface ReviewLearning {
  /** Root comment id of the thread — the dedup unit. */
  thread_id: number;
  /** Id of the comment that carried the instruction. */
  comment_id: number;
  /** File the thread is attached to (repo-relative), when present. */
  path?: string;
  line?: number;
  author: string;
  /** The instruction text (trimmed, capped). */
  instruction: string;
  url?: string;
  pr_number?: number;
}

interface RawReviewComment {
  id?: number;
  in_reply_to_id?: number;
  path?: string;
  line?: number | null;
  original_line?: number | null;
  body?: string;
  user?: { login?: string; type?: string };
  html_url?: string;
  pull_request_url?: string;
}

/** Explicit opt-in marker — a reply carrying it is ALWAYS a learning, whatever its shape. */
export const REVIEW_LEARNING_MARKER = /(^|\s)\/?hivelore[:,]?\s+remember\b|(^|\s)hivelore:/i;

/**
 * Instruction shape: imperative review guidance worth persisting. Deliberately conservative —
 * a question, a nit emoji, or "LGTM" must never become corpus. The explicit marker bypasses this.
 */
const INSTRUCTION_RE =
  /\b(never|always|don'?t|do not|must(?: not)?|should(?: not|n'?t)?|avoid|prefer|instead of|use\s+\S+\s+instead)\b/i;

const MAX_INSTRUCTION_CHARS = 500;
const MIN_INSTRUCTION_CHARS = 12;

function prNumberFrom(comment: RawReviewComment): number | undefined {
  const m = comment.pull_request_url?.match(/\/pulls\/(\d+)$/);
  return m ? Number(m[1]) : undefined;
}

/**
 * Extract learnings from a GitHub pull-request review-comments payload.
 * Kept: human-authored comments that either carry the `hivelore:`/`/hivelore remember` marker or
 * read as an instruction. Bots are dropped (their guidance belongs to their own config), as are
 * short reactions. One learning per comment; the thread id ties replies to their root.
 */
export function extractReviewLearnings(payload: unknown): ReviewLearning[] {
  if (!Array.isArray(payload)) return [];
  const comments = payload as RawReviewComment[];
  const learnings: ReviewLearning[] = [];
  for (const comment of comments) {
    if (typeof comment?.id !== "number") continue;
    if ((comment.user?.type ?? "").toLowerCase() === "bot") continue;
    const body = (comment.body ?? "").trim();
    if (body.length < MIN_INSTRUCTION_CHARS) continue;
    const marked = REVIEW_LEARNING_MARKER.test(body);
    if (!marked && !INSTRUCTION_RE.test(body)) continue;
    const instruction = body
      .replace(REVIEW_LEARNING_MARKER, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_INSTRUCTION_CHARS);
    if (instruction.length < MIN_INSTRUCTION_CHARS) continue;
    learnings.push({
      thread_id: comment.in_reply_to_id ?? comment.id,
      comment_id: comment.id,
      ...(comment.path ? { path: comment.path } : {}),
      ...(typeof (comment.line ?? comment.original_line) === "number"
        ? { line: (comment.line ?? comment.original_line) as number }
        : {}),
      author: comment.user?.login ?? "reviewer",
      instruction,
      ...(comment.html_url ? { url: comment.html_url } : {}),
      ...(prNumberFrom(comment) !== undefined ? { pr_number: prNumberFrom(comment) } : {}),
    });
  }
  return learnings;
}

export interface ReviewDraftOptions {
  scope?: "personal" | "team" | "module";
  module?: string;
  author?: string;
  limit?: number;
}

/** Template review learnings into proposed-memory drafts (reuses the scanner-ingest draft shape). */
export function reviewLearningsToDrafts(
  learnings: ReviewLearning[],
  options: ReviewDraftOptions = {},
): MemoryDraft[] {
  const limit = options.limit ?? 20;
  const drafts: MemoryDraft[] = [];
  const seenThreads = new Set<number>();
  for (const learning of learnings) {
    if (drafts.length >= limit) break;
    // One draft per thread — the latest instruction in a thread supersedes the chatter above it,
    // and extractReviewLearnings preserves payload order (GitHub returns ascending by id).
    if (seenThreads.has(learning.thread_id)) {
      const idx = drafts.findIndex((d) => d.key === `github-pr:${learning.thread_id}`);
      if (idx >= 0) drafts.splice(idx, 1);
    }
    seenThreads.add(learning.thread_id);

    const key = `github-pr:${learning.thread_id}`;
    const slugSource = learning.instruction.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
    const slug = slugSource.trim().split(/\s+/).slice(0, 6).join("-") || "review-learning";
    const finding: Finding = {
      tool: "github-pr",
      ruleId: "review-learning",
      severity: "major",
      message: learning.instruction,
      path: learning.path ?? "",
      ...(learning.line !== undefined ? { line: learning.line } : {}),
      key,
    };
    const baseFm = buildFrontmatter({
      type: "convention",
      slug,
      scope: options.scope ?? "team",
      module: options.module,
      tags: ["review-learning"],
      paths: learning.path ? [learning.path] : [],
      author: options.author ?? learning.author,
    });
    const frontmatter = { ...baseFm, status: "proposed" as const, topic: `ingest:${key}` };
    const provenance = [
      learning.pr_number !== undefined ? `PR #${learning.pr_number}` : null,
      `@${learning.author}`,
      learning.url ?? null,
    ].filter(Boolean).join(" · ");
    const body =
      `# Review learning: ${learning.instruction.slice(0, 80)}\n\n` +
      `${learning.instruction}\n\n` +
      (learning.path ? `Applies to: \`${learning.path}\`${learning.line !== undefined ? ` (line ${learning.line} at review time)` : ""}\n\n` : "") +
      `_From a review thread (${provenance}). Review: approve, refine, or reject — then consider ` +
      `\`hivelore sensors propose\` to make it a deterministic gate._\n`;
    drafts.push({ key, topic: `ingest:${key}`, frontmatter, body, finding, has_sensor: false });
  }
  return drafts;
}
