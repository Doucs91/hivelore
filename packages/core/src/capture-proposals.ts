/**
 * Capture proposals — memory candidates derived from what the branch DID, not from the agent's
 * initiative.
 *
 * Field reports #8 §6, #9 §7 and #11: capture that depends on the agent remembering to call
 * `mem_tried`/`post_task` stays weak, and the most valuable lesson of a session ended up in an agent's
 * private store because writing a Hivelore memory was a separate chore. This module reads observable
 * signals and proposes 0–N candidates, each with the exact command that records it:
 *
 *   incident-link     a commit says it fixes a regression ("broken since", "regression", a revert) and
 *                     touches code a decision/convention memory anchors → amend that memory's
 *                     evidence (`cannot_detect`) and arm a checklist, so the same verification gap
 *                     cannot pass silently twice (#9 §9.4);
 *   sensor-scope-gap  the branch REMOVED lines matching a regex sensor's pattern in files OUTSIDE the
 *                     sensor's scope — someone fixed the very bug class the sensor guards, where the
 *                     sensor does not look → widen its paths (#11 "a concrete miss");
 *   fix-lesson        a `fix:` commit whose message explains a cause ("because", "root cause", "was
 *                     caused by") on files no memory covers → a gotcha candidate, rule = that sentence;
 *   repeated-failure  the same substantive command failed repeatedly this session → an attempt
 *                     candidate (what failed; the agent fills in what worked).
 *
 * Pure and deterministic: no LLM writes content; every proposal quotes its evidence (a commit, a
 * removed line, a failure count) and a human or agent decides. Nothing is written here.
 */
import { globToRegExp, isGlobPath } from "./relevance.js";
import { sensorAppliesToPath } from "./sensors.js";
import type { Memory, MemoryType } from "./types.js";

export interface BranchCommit {
  sha: string;
  subject: string;
  body: string;
  files: string[];
}

export interface BranchFileDiff {
  path: string;
  removed: string[];
  added: string[];
}

export interface RepeatedFailure {
  /** Sanitized command/summary. */
  summary: string;
  count: number;
  files?: string[];
}

export type CaptureProposalKind = "incident-link" | "sensor-scope-gap" | "fix-lesson" | "repeated-failure";

export interface CaptureProposal {
  kind: CaptureProposalKind;
  /** One line: what to capture. */
  title: string;
  /** The observable evidence behind the proposal. */
  evidence: string;
  /** Existing memory the proposal amends (incident-link, sensor-scope-gap). */
  memory_id?: string;
  /** Type of the NEW memory to record (fix-lesson, repeated-failure). */
  type?: MemoryType;
  /** Suggested one-line rule for a new memory. */
  rule?: string;
  paths: string[];
  commit?: string;
  /** Ready-to-run commands, in order. */
  commands: string[];
}

export interface CaptureProposalInput {
  commits: BranchCommit[];
  diff: BranchFileDiff[];
  memories: Memory[];
  failures?: RepeatedFailure[];
  /** Max proposals returned (default 5). */
  limit?: number;
}

const REGRESSION_RE =
  /\b(?:regression|regressed|broken since|broke (?:in|since|with|after)|was broken by|introduced (?:in|by)|caused by (?:#\d+|[0-9a-f]{7,40}|commit|pr)|root cause|hotfix|r[ée]gression|cass[ée] depuis|introduit par)\b|^revert\b/i;
const FIX_SUBJECT_RE = /^(?:fix|hotfix|bugfix)(?:\([^)]*\))?!?:|^fix(?:es|ed)?\s/i;
const CAUSAL_RE =
  /\b(?:because|caused by|root cause|due to|turned out|the (?:issue|problem|bug|cause) was|was (?:silently|being|never|not)|otherwise|so that|which (?:broke|meant|caused)|parce que|à cause|en raison|sinon)\b/i;
const NON_SOURCE_RE = /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb|Cargo\.lock|go\.sum|poetry\.lock|composer\.lock)$|^\.ai\/|(?:^|\/)CHANGELOG[^/]*$|\.(?:md|mdx|rst|txt|snap)$|(?:^|\/)dist\//i;
/** Version manifests change in every release commit — never evidence that a decision failed. */
const MANIFEST_RE = /(?:^|\/)(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|composer\.json|Gemfile)$/;
const TRAILER_RE = /^(?:Co-Authored-By|Signed-off-by|Reviewed-by|Acked-by|Change-Id|Hivelore-[\w-]+):.*$/gim;

function stripTrailers(body: string): string {
  return body.replace(TRAILER_RE, "");
}

const ANCHORING_TYPES = new Set<MemoryType>(["decision", "convention", "architecture", "gotcha"]);

function shellQuote(text: string): string {
  return `"${text.replace(/(["\\$`])/g, "\\$1")}"`;
}

function short(sha: string): string {
  return sha.slice(0, 8);
}

function anchorMatches(anchor: string, file: string): boolean {
  const a = anchor.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!a) return false;
  if (isGlobPath(a)) return globToRegExp(a).test(file);
  return file === a || file.startsWith(`${a}/`);
}

function isLive(memory: Memory): boolean {
  const s = memory.frontmatter.status;
  return s !== "rejected" && s !== "deprecated" && s !== "stale" && memory.frontmatter.type !== "session_recap";
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
}

/** A memory already covers a lesson when it anchors one of its files and shares its vocabulary. */
function covered(memories: Memory[], files: string[], text: string): boolean {
  const words = tokens(text);
  return memories.some((m) => {
    if (!m.frontmatter.anchor.paths.some((a) => files.some((f) => anchorMatches(a, f)))) return false;
    const mine = tokens(`${m.frontmatter.rule ?? ""} ${m.body}`);
    let shared = 0;
    for (const w of words) if (mine.has(w)) shared++;
    return shared >= 3;
  });
}

/** Directory scope to suggest for files a sensor missed: `frontend/**`, or `packages/web/**`. */
export function suggestScope(file: string): string {
  const parts = file.split("/");
  if (parts.length <= 1) return file;
  const container = /^(?:packages|apps|services|libs|modules|projects|src)$/i.test(parts[0]!) && parts.length > 2;
  return `${parts.slice(0, container ? 2 : 1).join("/")}/**`;
}

function firstCausalSentence(text: string): string | undefined {
  const sentences = text
    .replace(/\r/g, "")
    .split(/\n{2,}|(?<=[.!?])\s+|\n(?=[-*] )/)
    .map((s) => s.replace(/^[-*]\s+/, "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 25 && !/^(?:co-authored-by|signed-off-by|hivelore-checked|refs?|closes|fixes)\b/i.test(s));
  return sentences.find((s) => CAUSAL_RE.test(s));
}

function regexFor(pattern: string, flags?: string): RegExp | undefined {
  try {
    return new RegExp(pattern, (flags ?? "").replace(/[gy]/g, ""));
  } catch {
    return undefined;
  }
}

export function proposeCaptures(input: CaptureProposalInput): CaptureProposal[] {
  const limit = input.limit ?? 5;
  const live = input.memories.filter(isLive);
  const out: CaptureProposal[] = [];
  const amended = new Set<string>();
  /** Commits already turned into an incident link: their lesson is the amendment, not a new gotcha. */
  const linkedCommits = new Set<string>();

  // ── 1. Incident links: a regression fix touching code a memory justified ──
  // Only a commit that IS a fix (conventional fix/hotfix, or a revert) and SAYS it repairs a
  // regression qualifies — a feature commit that merely mentions the word is not an incident — and
  // only a targeted one: a fix spread over many files cannot be attributed to one decision.
  for (const commit of input.commits) {
    if (!FIX_SUBJECT_RE.test(commit.subject) && !/^revert\b/i.test(commit.subject)) continue;
    const message = `${commit.subject}\n${stripTrailers(commit.body)}`;
    if (!REGRESSION_RE.test(message) && !/^revert\b/i.test(commit.subject)) continue;
    const files = commit.files.filter((f) => !NON_SOURCE_RE.test(f) && !MANIFEST_RE.test(f));
    if (files.length === 0 || files.length > 8) continue;
    const named = new Set([...message.matchAll(/\b(\d{4}-\d{2}-\d{2}-[a-z_]+-[a-z0-9-]+)\b/g)].map((m) => m[1]!));
    const candidates = live
      .filter(({ frontmatter: fm }) => !amended.has(fm.id) && ANCHORING_TYPES.has(fm.type))
      .map((memory) => ({
        memory,
        hit: files.find((f) => memory.frontmatter.anchor.paths.some((a) => !isGlobPath(a) && anchorMatches(a, f))),
      }))
      .filter(({ memory, hit }) => hit || named.has(memory.frontmatter.id))
      // Named first, then decisions (they "justify" code), then the rest.
      .sort((a, b) => Number(named.has(b.memory.frontmatter.id)) - Number(named.has(a.memory.frontmatter.id)) ||
        Number(b.memory.frontmatter.type === "decision") - Number(a.memory.frontmatter.type === "decision"))
      .slice(0, 2);
    for (const { memory, hit } of candidates) {
      const fm = memory.frontmatter;
      amended.add(fm.id);
      linkedCommits.add(commit.sha);
      const target = hit ?? files[0]!;
      const hasChecklist = fm.sensor?.kind === "checklist";
      out.push({
        kind: "incident-link",
        title: `Regression fix touches code that ${fm.id} justified — record what its verification missed`,
        evidence: `${short(commit.sha)} "${commit.subject}" changes ${target}, which ${fm.id} anchors${fm.verified_by ? ` (verified by: ${fm.verified_by})` : ""}.`,
        memory_id: fm.id,
        paths: [target],
        commit: commit.sha,
        commands: [
          `hivelore memory update ${fm.id} --cannot-detect "<what the earlier verification could not observe>"`,
          ...(hasChecklist ? [] : [
            `hivelore sensors propose ${fm.id} --kind checklist --paths ${target} --message "<the verification that would have caught it>"`,
          ]),
        ],
      });
    }
  }

  // ── 2. Sensor scope gaps: the bug class fixed where the sensor does not look ──
  for (const memory of live) {
    const sensor = memory.frontmatter.sensor;
    if (!sensor || sensor.kind !== "regex" || !sensor.pattern || sensor.require_present) continue;
    const anchors = memory.frontmatter.anchor.paths;
    if (sensor.paths.length === 0 && anchors.length === 0) continue; // repo-wide already
    const re = regexFor(sensor.pattern, sensor.flags);
    if (!re) continue;
    const absent = sensor.absent ? regexFor(sensor.absent, sensor.flags) : undefined;
    const gapFiles: Array<{ file: string; line: string }> = [];
    for (const file of input.diff) {
      if (NON_SOURCE_RE.test(file.path) || sensorAppliesToPath(sensor, anchors, file.path)) continue;
      const removedHits = file.removed.filter((l) => re.test(l) && !(absent?.test(l)));
      if (removedHits.length === 0) continue;
      const addedHits = file.added.filter((l) => re.test(l) && !(absent?.test(l))).length;
      if (addedHits >= removedHits.length) continue; // moved, not fixed
      gapFiles.push({ file: file.path, line: removedHits[0]!.trim() });
    }
    if (gapFiles.length === 0) continue;
    const scopes = [...new Set(gapFiles.map((g) => suggestScope(g.file)))].slice(0, 3);
    const current = sensor.paths.length > 0 ? sensor.paths : anchors;
    out.push({
      kind: "sensor-scope-gap",
      title: `Sensor ${memory.frontmatter.id} guards this bug class, but not in ${scopes.join(", ")}`,
      evidence: `This branch removed \`${gapFiles[0]!.line.slice(0, 120)}\` from ${gapFiles[0]!.file}` +
        (gapFiles.length > 1 ? ` (+${gapFiles.length - 1} more file${gapFiles.length > 2 ? "s" : ""})` : "") +
        `; the sensor only scans ${current.join(", ")}.`,
      memory_id: memory.frontmatter.id,
      paths: gapFiles.map((g) => g.file).slice(0, 5),
      commands: [
        `hivelore memory update ${memory.frontmatter.id} --sensor-paths ${[...current, ...scopes].join(",")}`,
      ],
    });
  }

  // ── 3. Fix lessons: a fix commit that explains its cause, on files no memory covers ──
  for (const commit of input.commits) {
    if (!FIX_SUBJECT_RE.test(commit.subject) || linkedCommits.has(commit.sha)) continue;
    if (commit.files.some((f) => f.startsWith(".ai/memories/"))) continue; // captured in the same commit
    const files = commit.files.filter((f) => !NON_SOURCE_RE.test(f)).slice(0, 3);
    if (files.length === 0) continue;
    const cause = firstCausalSentence(commit.body) ?? (CAUSAL_RE.test(commit.subject) ? commit.subject : undefined);
    if (!cause) continue;
    if (covered(live, files, `${commit.subject} ${cause}`)) continue;
    const title = commit.subject.replace(FIX_SUBJECT_RE, "").trim() || commit.subject;
    const rule = cause.length > 220 ? `${cause.slice(0, 219).trimEnd()}…` : cause;
    out.push({
      kind: "fix-lesson",
      title: `Gotcha from ${short(commit.sha)}: ${title}`,
      evidence: `${short(commit.sha)} "${commit.subject}" explains its cause: "${rule}"`,
      type: "gotcha",
      rule,
      paths: files,
      commit: commit.sha,
      commands: [
        `hivelore memory add --type gotcha --scope team --title ${shellQuote(title)} --paths ${files.join(",")} ` +
        `--rule ${shellQuote(rule)} --evidence observed --verified-by ${shellQuote(`fix ${short(commit.sha)}`)}`,
      ],
    });
  }

  // ── 4. Repeated failures: a retry loop on a substantive command ──
  for (const failure of input.failures ?? []) {
    if (failure.count < 2) continue;
    const files = (failure.files ?? []).filter((f) => !NON_SOURCE_RE.test(f)).slice(0, 3);
    if (covered(live, files, failure.summary)) continue;
    out.push({
      kind: "repeated-failure",
      title: `\`${failure.summary.slice(0, 80)}\` failed ${failure.count}× this session`,
      evidence: `${failure.count} failures with the same normalized command. If the fix was non-obvious, record it; if it was a typo, skip.`,
      type: "attempt",
      paths: files,
      commands: [
        `hivelore memory tried --what ${shellQuote(failure.summary.slice(0, 80))} --why-failed "<the real cause>" --instead "<what worked>"` +
        (files.length ? ` --paths ${files.join(",")}` : ""),
      ],
    });
  }

  const order: Record<CaptureProposalKind, number> = { "incident-link": 0, "sensor-scope-gap": 1, "fix-lesson": 2, "repeated-failure": 3 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, limit);
}

/** Parse `git diff --unified=0` output into per-file removed/added lines. Pure. */
export function parseUnifiedDiff(diff: string): BranchFileDiff[] {
  const files: BranchFileDiff[] = [];
  let current: BranchFileDiff | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = undefined;
      continue;
    }
    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      if (target === "/dev/null") { current = undefined; continue; }
      current = { path: target.replace(/^b\//, ""), removed: [], added: [] };
      files.push(current);
      continue;
    }
    if (line.startsWith("--- ")) continue;
    if (!current) continue;
    if (line.startsWith("+")) current.added.push(line.slice(1));
    else if (line.startsWith("-")) current.removed.push(line.slice(1));
  }
  return files;
}

/** Plain-text rendering for the CLI. */
export function renderCaptureProposals(proposals: CaptureProposal[]): string {
  if (proposals.length === 0) {
    return "No capture candidates on this branch. (Nothing to record is the normal outcome for routine work.)";
  }
  const lines: string[] = [`${proposals.length} capture candidate(s) — keep only what a teammate could not guess:`];
  proposals.forEach((p, i) => {
    lines.push("", `${i + 1}. [${p.kind}] ${p.title}`, `   evidence: ${p.evidence}`);
    for (const command of p.commands) lines.push(`   $ ${command}`);
  });
  return lines.join("\n");
}
