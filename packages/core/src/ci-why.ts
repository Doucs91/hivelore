/**
 * `ci why` — "why is CI red?", answered from the failed log and from what the team already knows.
 *
 * Agents spend real time on this: list the runs, open the failed job, scroll a 5,000-line log, guess
 * whether it is the code, a flaky test, or the runner. Field reviews also asked that a job that never
 * STARTED (billing, quota, missing runner) be named as such instead of read as "pending" or "failed".
 * This module is the pure part: pull the signal lines out of `gh run view --log-failed`, classify
 * job annotations, and relate the failure to recorded memories. The CLI fetches; nothing here runs.
 */
import { memoryRuleLine } from "./rule-line.js";
import type { Memory } from "./types.js";

export interface CiJobFailure {
  job: string;
  step: string;
  errors: string[];
}

export interface CiFailureSignals {
  jobs: CiJobFailure[];
  failing_tests: string[];
}

export type CiInfraCause = "billing" | "runner" | "timeout" | "cancelled";

const ANSI = /\u001b\[[0-9;]*m/g;
const TIMESTAMP = /^﻿?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s?/;
const ERROR_LINE =
  /##\[error\]|\berror(?:\[\w+\])?:|\((?:error|blocking)\):|\berror TS\d+|\bTS\d{4}:|\bAssertionError\b|\bExpected\b.*\b(?:received|to\b)|npm ERR!|ERR_PNPM|ELIFECYCLE|\bTraceback\b|\bfatal:|\bpanic:|Command failed|\bFAIL\b|^\s*[×✗]\s|\bexit code [1-9]\d*/i;
const NOISE = /\b0 errors?\b|errors?: 0\b|^\s*$|Process completed with exit code \d+\.\s*$/i;

function clean(line: string): string {
  return line.replace(ANSI, "").replace(TIMESTAMP, "").replace(/\s+/g, " ").trim();
}

/** Signal lines from `gh run view --log-failed` output (`job\tstep\ttimestamp message`). */
export function extractCiFailureSignals(log: string, maxErrorsPerJob = 10): CiFailureSignals {
  const byJob = new Map<string, CiJobFailure>();
  const tests = new Set<string>();
  const exitOnly = new Map<string, string>();
  for (const raw of log.split("\n")) {
    const parts = raw.split("\t");
    const [job, step, rest] = parts.length >= 3 ? [parts[0]!, parts[1]!, parts.slice(2).join("\t")] : ["(log)", "", raw];
    const line = clean(rest);
    if (!line) continue;
    const testMatch =
      /^\s*[×✗]\s+(.+?)(?:\s+\d+ms)?$/.exec(line) ??
      /\bFAIL\s+(\S+\.(?:test|spec)\.\w+(?:\s+>\s+.+)?)/.exec(line) ??
      /^●\s+(.+›.+)$/.exec(line) ??
      /\bFAILED\s+(\S+::\S+)/.exec(line) ??
      /^--- FAIL: (\S+)/.exec(line);
    if (testMatch) tests.add(testMatch[1]!.trim().slice(0, 200));
    if (!ERROR_LINE.test(line)) continue;
    const key = `${job}\u0000${step}`;
    if (NOISE.test(line)) {
      if (/Process completed with exit code/.test(line)) exitOnly.set(key, line);
      continue;
    }
    const entry = byJob.get(key) ?? { job, step, errors: [] };
    const text = line.replace(/^##\[error\]/, "").slice(0, 300);
    if (!entry.errors.includes(text) && entry.errors.length < maxErrorsPerJob) entry.errors.push(text);
    byJob.set(key, entry);
  }
  // A step that only says "exit code 1" still names WHERE it failed.
  for (const [key, line] of exitOnly) {
    if (byJob.has(key)) continue;
    const [job, step] = key.split("\u0000") as [string, string];
    byJob.set(key, { job, step, errors: [line] });
  }
  return { jobs: [...byJob.values()], failing_tests: [...tests].slice(0, 20) };
}

/** True when a job's only signal is "exit code N" — the reason is in an earlier step's output. */
export function onlyExitCodes(job: CiJobFailure): boolean {
  return job.errors.length > 0 && job.errors.every((e) => /exit code \d+/i.test(e));
}

/** A job annotation that means the code was never tested: billing, runners, timeouts, cancellation. */
export function classifyCiAnnotation(message: string): CiInfraCause | null {
  if (/recent account payments have failed|spending limit|billing|payment/i.test(message)) return "billing";
  if (/no runner|waiting for a runner|runner .*not found|not acquired|no hosted runner|runner.*offline/i.test(message)) return "runner";
  if (/exceeded the maximum execution time|timed out|timeout/i.test(message)) return "timeout";
  if (/operation was cancell?ed|was cancell?ed/i.test(message)) return "cancelled";
  return null;
}

const COMMON = new Set([
  "error", "errors", "failed", "failure", "expected", "received", "tests", "test", "should", "process",
  "completed", "command", "string", "number", "object", "undefined", "function", "return", "github",
  "runner", "workflow", "report", "found", "cannot", "could", "which", "there", "their", "about",
]);

function distinctive(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9_.-]+/).map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
      .filter((w) => w.length >= 5 && !COMMON.has(w) && !/^\d+$/.test(w)),
  );
}

export interface CiRelatedMemory {
  id: string;
  type: string;
  rule: string;
  shared: string[];
}

/** Memories whose words overlap the failure — "we have seen this before". */
export function relateCiFailure(signals: CiFailureSignals, memories: Memory[], limit = 3): CiRelatedMemory[] {
  const failureWords = distinctive([...signals.jobs.flatMap((j) => j.errors), ...signals.failing_tests].join(" "));
  if (failureWords.size === 0) return [];
  const scored: Array<CiRelatedMemory & { score: number }> = [];
  for (const memory of memories) {
    const fm = memory.frontmatter;
    if (!["attempt", "gotcha", "convention", "decision"].includes(fm.type)) continue;
    if (["rejected", "deprecated", "stale"].includes(fm.status)) continue;
    const words = distinctive(`${fm.rule ?? ""} ${memory.body} ${fm.anchor.paths.join(" ")}`);
    const shared = [...failureWords].filter((w) => words.has(w));
    if (shared.length < 2) continue;
    scored.push({ id: fm.id, type: fm.type, rule: memoryRuleLine(memory) || fm.id, shared: shared.slice(0, 6), score: shared.length + (fm.type === "attempt" ? 1 : 0) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _score, ...rest }) => rest);
}
