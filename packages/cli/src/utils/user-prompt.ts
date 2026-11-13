/**
 * `hivelore enforce user-prompt` — Claude Code UserPromptSubmit hook.
 *
 * When the developer's message states a lasting rule while correcting the agent, the hook tells the
 * agent so (one paragraph of additionalContext) and records the rule locally, so `memory propose` can
 * offer it as a capture candidate at the end of the task. Silent for every other message.
 *
 * In a repository WITHOUT Hivelore (the hook arrives through the user-level plugin), the agent may
 * mention once per session that Hivelore can turn such corrections into enforced rules — an offer for
 * the moment it is relevant, never an install.
 *
 * Privacy: only the rule sentence (≤ 240 chars) is stored, in the machine-local cache directory, and
 * entries older than 14 days are dropped. Prompts are never written anywhere else.
 */
import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  correctionNudge,
  detectUserCorrection,
  findProjectRoot,
  isHiveloreInitialized,
  normalizeSessionId,
  resolveHaivePaths,
  type RecordedCorrection,
} from "@hivelore/core";

export interface UserPromptPayload {
  cwd?: string;
  session_id?: string;
  prompt?: string;
}

const CORRECTIONS_FILE = "corrections.jsonl";
const RETENTION_MS = 14 * 86_400_000;

export function correctionsFile(cacheDir: string): string {
  return path.join(cacheDir, CORRECTIONS_FILE);
}

export async function readRecordedCorrections(cacheDir: string, now = Date.now()): Promise<RecordedCorrection[]> {
  const file = correctionsFile(cacheDir);
  if (!existsSync(file)) return [];
  const out: RecordedCorrection[] = [];
  for (const line of (await readFile(file, "utf8").catch(() => "")).split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as RecordedCorrection;
      if (row.rule && row.at && now - Date.parse(row.at) < RETENTION_MS) out.push(row);
    } catch { /* corrupt line */ }
  }
  return out;
}

async function recordCorrection(cacheDir: string, row: RecordedCorrection & { session_id: string }): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true });
    const kept = (await readRecordedCorrections(cacheDir)).map((r) => JSON.stringify(r));
    // Rewrite when old rows expired, append otherwise — the file stays small and bounded.
    const file = correctionsFile(cacheDir);
    if (kept.length > 200) await writeFile(file, kept.slice(-200).join("\n") + "\n", "utf8");
    await appendFile(file, JSON.stringify(row) + "\n", "utf8");
  } catch { /* the nudge matters more than the record */ }
}

/**
 * Once per session for the "Hivelore could enforce this" offer in an uninitialised repo. The flag
 * lives in the system temp directory: nothing may be written inside a repository that never asked
 * for Hivelore.
 */
async function offeredThisSession(sessionId: string): Promise<boolean> {
  const marker = path.join(os.tmpdir(), "hivelore-offers", `${normalizeSessionId(sessionId)}.flag`);
  if (existsSync(marker)) return true;
  try {
    await mkdir(path.dirname(marker), { recursive: true });
    await writeFile(marker, new Date().toISOString(), "utf8");
  } catch { /* best effort */ }
  return false;
}

/** Returns the additionalContext to emit, or null to stay silent. */
export async function handleUserPrompt(payload: UserPromptPayload, dir?: string): Promise<string | null> {
  const prompt = payload.prompt ?? "";
  const correction = detectUserCorrection(prompt);
  if (!correction) return null;
  let root: string;
  try { root = findProjectRoot(dir ?? payload.cwd); } catch { return null; }
  const paths = resolveHaivePaths(root);
  const initialized = isHiveloreInitialized(root);
  const sessionId = payload.session_id?.trim() || "default";
  if (initialized) {
    await recordCorrection(paths.cacheDir, { rule: correction.rule, at: new Date().toISOString(), strength: correction.strength, session_id: sessionId });
    return correctionNudge(correction, true);
  }
  if (await offeredThisSession(sessionId)) return null;
  return correctionNudge(correction, false);
}
