import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  estimateTokens, recordKnowledgeOutcome, memoryRuleLine, isGlobPath, globToRegExp, sensorAppliesToPath,
  loadMemoriesFromDir, memoryMatchesAnchorPaths, isRetiredMemory, verifyAnchor,
  readSessionBriefingMarker, writeBriefingMarker, trackReads, supersededMemoryIds,
  normalizeSessionId, type HaivePaths,
} from "@hivelore/core";
import { sessionIdentity } from "./task-session.js";

/**
 * Memory types worth interrupting an edit for. A gotcha/convention/attempt says "this file has this
 * trap; do X instead" — what an agent needs at edit time. Measured over 712 reminders, 82% were
 * decisions and one session recap, 13% gotchas or conventions (field report #12 §1.1): recaps never
 * fire here, and a decision fires only when it is anchored to the exact file being edited, never
 * through a directory or a whole-doc anchor.
 */
const EDIT_TIME_TYPES = new Set(["gotcha", "convention", "attempt", "architecture"]);

function normalizeAnchor(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function exactAnchorMatch(memory: { frontmatter: { anchor: { paths: string[] } } }, file: string): boolean {
  return memory.frontmatter.anchor.paths.some((anchor) => {
    const a = normalizeAnchor(anchor);
    return a === file || (isGlobPath(a) && globToRegExp(a).test(file));
  });
}

/** id → ISO time it was shown. Entries expire so a shared "default" session never mutes a memory for good. */
interface EditContextLedger { shown: Record<string, string> }
const LEDGER_TTL_MS = 12 * 60 * 60 * 1000;

function editLedgerPath(paths: HaivePaths, sessionId: string): string {
  return path.join(paths.runtimeDir, "edit-context", `${sessionId}.json`);
}

async function readEditLedger(paths: HaivePaths, sessionId: string): Promise<EditContextLedger> {
  try {
    const parsed = JSON.parse(await readFile(editLedgerPath(paths, sessionId), "utf8")) as { shown?: unknown };
    const shown: Record<string, string> = {};
    if (parsed.shown && typeof parsed.shown === "object" && !Array.isArray(parsed.shown)) {
      const now = Date.now();
      for (const [id, at] of Object.entries(parsed.shown as Record<string, unknown>)) {
        const t = typeof at === "string" ? Date.parse(at) : NaN;
        if (Number.isFinite(t) && now - t < LEDGER_TTL_MS) shown[id] = at as string;
      }
    }
    return { shown };
  } catch {
    return { shown: {} };
  }
}

async function writeEditLedger(paths: HaivePaths, sessionId: string, ledger: EditContextLedger): Promise<void> {
  try {
    const file = editLedgerPath(paths, sessionId);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(ledger) + "\n", "utf8");
  } catch { /* the ledger only dedupes; losing it repeats a reminder, never blocks */ }
}

/** A fresh session (not a compaction/resume) starts with no reminders shown. */
export async function resetEditContextLedger(paths: HaivePaths, sessionId?: string): Promise<void> {
  await rm(editLedgerPath(paths, normalizeSessionId(sessionIdentity(sessionId))), { force: true }).catch(() => {});
}

function typeRank(type: string): number {
  return type === "attempt" || type === "gotcha" ? 0 : type === "convention" ? 1 : 2;
}

/**
 * Quiet unless new, applicable context exists. At most one reminder per memory per session, each
 * carrying the rule itself — never a bare pointer (field reports #9 §3, #12 §3.1, §4.2). Only fully
 * delivered bodies count as consulted.
 */
export async function injectFileContext(paths: HaivePaths, files: string[], sessionId?: string): Promise<string | null> {
  const relative = files.map(file => path.relative(paths.root, path.resolve(paths.root, file)).replace(/\\/g, "/"))
    .filter(file => file && file !== ".." && !file.startsWith("../") && !file.startsWith(".ai/"));
  if (!relative.length) return null;
  const id = normalizeSessionId(sessionIdentity(sessionId));
  const marker = await readSessionBriefingMarker(paths, id);
  const consulted = new Set(marker?.memory_ids ?? []);
  const ledger = await readEditLedger(paths, id);
  const shown = new Set(Object.keys(ledger.shown));
  const all = await loadMemoriesFromDir(paths.memoriesDir);
  const verified = [];
  for (const item of all) {
    if (!item.memory.frontmatter.checks?.length || !(await verifyAnchor(item.memory, { projectRoot: paths.root })).stale) verified.push(item);
  }
  const superseded = supersededMemoryIds(verified);
  const candidates = verified.filter(({ memory: m }) => {
    const fm = m.frontmatter;
    if (fm.status !== "validated" || isRetiredMemory(fm, m.body)) return false;
    if (consulted.has(fm.id) || shown.has(fm.id) || superseded.has(fm.id)) return false;
    if (fm.sensor?.kind === "checklist") return relative.some((file) => sensorAppliesToPath(fm.sensor!, fm.anchor.paths, file));
    if (fm.requires_human_approval) return memoryMatchesAnchorPaths(m, relative);
    if (fm.sensor?.severity === "block") return memoryMatchesAnchorPaths(m, relative);
    if (fm.type === "decision") return relative.some((file) => exactAnchorMatch(m, file));
    return EDIT_TIME_TYPES.has(fm.type) && memoryMatchesAnchorPaths(m, relative);
  })
    .sort((a, b) => Number(b.memory.frontmatter.requires_human_approval) - Number(a.memory.frontmatter.requires_human_approval) ||
      Number(b.memory.frontmatter.sensor?.severity === "block") - Number(a.memory.frontmatter.sensor?.severity === "block") ||
      typeRank(a.memory.frontmatter.type) - typeRank(b.memory.frontmatter.type));
  const displayed = [];
  for (const candidate of candidates) {
    if ((await verifyAnchor(candidate.memory, { projectRoot: paths.root })).stale) continue;
    displayed.push(candidate);
    if (displayed.length === 3) break;
  }
  if (!displayed.length) return null;
  const chunks = [`Hivelore — before editing ${relative.slice(0, 2).join(", ")}${relative.length > 2 ? ", …" : ""}:`];
  const ids: string[] = [];
  const newlyShown: string[] = [];
  for (const { memory: m } of displayed) {
    const fm = m.frontmatter;
    const completeBody = m.body.replace(/^#{1,3}\s+.+\n+/, "").trim();
    const complete = completeBody.length > 0 && completeBody.length <= 420;
    const rule = memoryRuleLine(m) || completeBody.split("\n")[0] || fm.id;
    const lines = fm.sensor?.kind === "checklist"
      ? [`• Required verification before shipping: ${fm.sensor.message}`]
      : [`• ${complete ? completeBody : rule}`];
    const tail = [`${fm.type} ${fm.id}`];
    if (fm.requires_human_approval) tail.unshift("HUMAN CONFIRMATION REQUIRED");
    if (fm.source) tail.push(`source: ${fm.source}`);
    if (fm.sensor?.kind === "checklist" && fm.sensor.severity === "block") tail.push(`commit trailer: Hivelore-Checked: ${fm.id}`);
    else if (!complete) tail.push("details: mem_get");
    lines.push(`  (${tail.join(" · ")})`);
    const entry = lines.join("\n");
    if (estimateTokens([...chunks, entry].join("\n")) > 300) continue;
    chunks.push(entry);
    newlyShown.push(fm.id);
    // A rule line is not consultation of the whole instruction; a complete body is.
    if (complete) ids.push(fm.id);
  }
  if (chunks.length === 1) return null;
  const text = chunks.join("\n");
  const stamp = new Date().toISOString();
  await writeEditLedger(paths, id, { shown: { ...ledger.shown, ...Object.fromEntries(newlyShown.map((memoryId) => [memoryId, stamp])) } });
  await writeBriefingMarker(paths, { sessionId: id, task: marker?.task ?? "file context",
    source: "haive-pre-edit", files: relative, memoryIds: [...consulted, ...ids] });
  await trackReads(paths, ids);
  for (const memoryId of newlyShown) await recordKnowledgeOutcome(paths, { id: memoryId, kind: "exposed", session_id: id, files: relative, source: "hook", evidence: "observed" }).catch(() => {});
  return text;
}
