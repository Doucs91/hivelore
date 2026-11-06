/**
 * `why <file[:line]>` — everything the repository knows about a piece of code, in one answer.
 *
 * An agent about to change unfamiliar code asks one question: "why is this like this, and what breaks
 * if I change it?". The answer is scattered — decisions and gotchas anchored to the file, sensors that
 * guard it (and whether THIS line is what they look for), checklists, doc warnings, and the commit that
 * last touched the line. This assembles it, most binding first. Pure: the caller does the I/O.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { findDocCaveats, distinctiveEditTokens, loadDocFiles, type DocCaveat, type DocFile, type DocMention } from "./doc-caveats.js";
import { loadMemoriesFromDir } from "./loader.js";
import { resolveHaivePaths } from "./paths.js";
import { memoryRuleLine } from "./rule-line.js";
import { sensorAppliesToPath } from "./sensors.js";
import { globToRegExp, isGlobPath } from "./relevance.js";
import { isRetiredMemory } from "./memory-lifecycle.js";
import type { Memory } from "./types.js";

export interface WhyCommit {
  sha: string;
  subject: string;
  date?: string;
}

export interface WhyInput {
  file: string;
  line?: number;
  /** Content of the requested line (or a small window around it). */
  lineText?: string;
  memories: Memory[];
  docs?: DocFile[];
  /** The commit that last changed the line (git blame). */
  blame?: WhyCommit;
  /** Recent commits touching the file, newest first. */
  history?: WhyCommit[];
}

export interface WhyMemory {
  id: string;
  type: string;
  rule: string;
  /** exact = anchored to this file; area = a directory/glob anchor; symbol = the line names an anchored symbol. */
  match: "exact" | "area" | "symbol";
  blind_spot?: string;
  source?: string;
}

export interface WhySensor {
  id: string;
  kind: string;
  severity: string;
  message: string;
  /** regex only: does the requested line contain what the sensor looks for? */
  line_matches?: boolean;
}

export interface WhyReport {
  file: string;
  line?: number;
  memories: WhyMemory[];
  sensors: WhySensor[];
  checklists: Array<{ id: string; message: string; severity: string }>;
  doc_caveats: DocCaveat[];
  doc_mentions: DocMention[];
  blame?: WhyCommit;
  /** Commits touching the file whose message says they fixed something — the file's incident history. */
  fixes: WhyCommit[];
}

function normalize(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

function anchorMatch(anchor: string, file: string): "exact" | "area" | null {
  const a = normalize(anchor);
  if (!a) return null;
  if (a === file) return "exact";
  if (isGlobPath(a)) return globToRegExp(a).test(file) ? "area" : null;
  return file.startsWith(`${a}/`) ? "area" : null;
}

const FIX_RE = /^(?:fix|hotfix|bugfix)(?:\([^)]*\))?!?:|^revert\b|\b(?:regression|broken since|root cause)\b/i;

export function buildWhyReport(input: WhyInput): WhyReport {
  const file = normalize(input.file);
  const lineText = input.lineText ?? "";
  const live = input.memories.filter((m) => {
    const fm = m.frontmatter;
    return fm.type !== "session_recap" && !["rejected", "deprecated", "stale"].includes(fm.status) && !isRetiredMemory(fm, m.body);
  });

  const memories: WhyMemory[] = [];
  const sensors: WhySensor[] = [];
  const checklists: WhyReport["checklists"] = [];
  for (const memory of live) {
    const fm = memory.frontmatter;
    const sensor = fm.sensor;
    if (sensor) {
      if (sensor.kind === "checklist") {
        if ((sensor.paths.length || fm.anchor.paths.length) && sensorAppliesToPath(sensor, fm.anchor.paths, file)) {
          checklists.push({ id: fm.id, message: sensor.message, severity: sensor.severity });
        }
      } else if (sensor.kind !== "command" && sensorAppliesToPath(sensor, fm.anchor.paths, file)) {
        let lineMatches: boolean | undefined;
        if (sensor.kind === "regex" && sensor.pattern && lineText) {
          try { lineMatches = new RegExp(sensor.pattern, (sensor.flags ?? "").replace(/[gy]/g, "")).test(lineText); } catch { /* invalid */ }
        }
        sensors.push({ id: fm.id, kind: sensor.kind, severity: sensor.severity, message: sensor.message, ...(lineMatches !== undefined ? { line_matches: lineMatches } : {}) });
      }
    }
    let match: WhyMemory["match"] | null = null;
    for (const anchor of fm.anchor.paths) {
      const m = anchorMatch(anchor, file);
      if (m === "exact") { match = "exact"; break; }
      if (m === "area") match = "area";
    }
    if (!match && lineText && fm.anchor.symbols.some((s) => s.length >= 3 && new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lineText))) {
      match = "symbol";
    }
    if (!match) continue;
    memories.push({
      id: fm.id,
      type: fm.type,
      rule: memoryRuleLine(memory) || fm.id,
      match,
      ...(fm.cannot_detect ? { blind_spot: fm.cannot_detect } : {}),
      ...(fm.source ? { source: fm.source } : {}),
    });
  }
  const order = { exact: 0, symbol: 1, area: 2 } as const;
  const typeOrder = (t: string): number => ["gotcha", "attempt", "decision", "convention", "architecture"].indexOf(t) + 1 || 9;
  memories.sort((a, b) => order[a.match] - order[b.match] || typeOrder(a.type) - typeOrder(b.type) || a.id.localeCompare(b.id));
  sensors.sort((a, b) => Number(b.line_matches === true) - Number(a.line_matches === true) || Number(b.severity === "block") - Number(a.severity === "block"));

  const docs = input.docs?.length
    ? findDocCaveats(input.docs, { files: [file], keys: lineText ? distinctiveEditTokens(lineText, 8) : [] })
    : { caveats: [], mentions: [] };

  return {
    file,
    ...(input.line ? { line: input.line } : {}),
    memories: memories.slice(0, 8),
    sensors: sensors.slice(0, 8),
    checklists,
    doc_caveats: docs.caveats,
    doc_mentions: docs.mentions,
    ...(input.blame ? { blame: input.blame } : {}),
    fixes: (input.history ?? []).filter((c) => FIX_RE.test(c.subject)).slice(0, 5),
  };
}

export function renderWhyReport(report: WhyReport): string {
  const where = `${report.file}${report.line ? `:${report.line}` : ""}`;
  const lines: string[] = [`Why ${where}`];
  const empty = report.memories.length + report.sensors.length + report.checklists.length + report.doc_caveats.length === 0;
  if (report.blame) lines.push(`  last changed by ${report.blame.sha.slice(0, 8)} "${report.blame.subject}"${report.blame.date ? ` (${report.blame.date.slice(0, 10)})` : ""}`);
  if (report.checklists.length) {
    lines.push("", "Required verification when this file changes:");
    for (const c of report.checklists) lines.push(`  • ${c.message}  (${c.id}${c.severity === "block" ? " · commit trailer Hivelore-Checked" : ""})`);
  }
  if (report.sensors.length) {
    lines.push("", "Guarded by:");
    for (const s of report.sensors) {
      lines.push(`  • [${s.kind}/${s.severity}] ${s.message}  (${s.id})${s.line_matches ? "  ← this line matches" : ""}`);
    }
  }
  if (report.memories.length) {
    lines.push("", "What the team recorded:");
    for (const m of report.memories) {
      lines.push(`  • ${m.rule}  (${m.type} ${m.id}${m.match === "area" ? " · area" : m.match === "symbol" ? " · symbol" : ""})`);
      if (m.blind_spot) lines.push(`      blind spot: ${m.blind_spot}`);
      if (m.source) lines.push(`      source: ${m.source}`);
    }
  }
  if (report.doc_caveats.length) {
    lines.push("", "The docs warn:");
    for (const c of report.doc_caveats) lines.push(`  • ${c.doc}:${c.line} — ${c.text}`);
  }
  if (report.doc_mentions.length) lines.push(`  also documented in: ${report.doc_mentions.map((m) => `${m.doc}:${m.line}`).join(", ")}`);
  if (report.fixes.length) {
    lines.push("", "Past fixes in this file:");
    for (const f of report.fixes) lines.push(`  • ${f.sha.slice(0, 8)} ${f.subject}`);
  }
  if (empty && !report.fixes.length) lines.push("", "Nothing recorded about this code — no rule, sensor or doc warning applies.");
  return lines.join("\n");
}

const execAsync = promisify(execFile);

async function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return (await execAsync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })).stdout;
}

/** I/O half of `why`: read the line, blame it, list the file's history, load memories and docs. */
export function parseWhyTarget(target: string): { file: string; line?: number } {
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(target.trim());
  if (m && m[1]) return { file: m[1], line: Number(m[2]) };
  return { file: target.trim() };
}

export async function collectWhyReport(root: string, target: string): Promise<WhyReport> {
  const { file: raw, line } = parseWhyTarget(target);
  const file = path.relative(root, path.resolve(root, raw)).replace(/\\/g, "/");
  let lineText: string | undefined;
  if (line) {
    try {
      const lines = (await readFile(path.join(root, file), "utf8")).split("\n");
      lineText = lines.slice(Math.max(0, line - 1), line).join("\n");
    } catch { /* file deleted or binary */ }
  }
  let blame: WhyCommit | undefined;
  if (line) {
    try {
      const out = await run("git", ["blame", "-L", `${line},${line}`, "--porcelain", "--", file], root);
      const sha = out.split(/\s/)[0] ?? "";
      const subject = /^summary (.*)$/m.exec(out)?.[1];
      const time = /^author-time (\d+)$/m.exec(out)?.[1];
      if (sha && subject && !/^0+$/.test(sha)) blame = { sha, subject, ...(time ? { date: new Date(Number(time) * 1000).toISOString() } : {}) };
    } catch { /* untracked */ }
  }
  let history: WhyCommit[] = [];
  try {
    history = (await run("git", ["log", "-n", "40", "--format=%H%x1f%s%x1f%aI", "--", file], root))
      .split("\n").filter(Boolean)
      .map((l) => { const [sha, subject, date] = l.split("\x1f"); return { sha: sha!, subject: subject ?? "", ...(date ? { date } : {}) }; });
  } catch { /* not a git repo */ }
  const paths = resolveHaivePaths(root);
  const memories = existsSync(paths.memoriesDir) ? (await loadMemoriesFromDir(paths.memoriesDir)).map((l) => l.memory) : [];
  let docs: ReturnType<typeof loadDocFiles> = [];
  try { docs = loadDocFiles(root); } catch { /* docs are a bonus */ }
  return buildWhyReport({ file, ...(line ? { line } : {}), ...(lineText ? { lineText } : {}), memories, docs, ...(blame ? { blame } : {}), history });
}

