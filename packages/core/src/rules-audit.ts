/**
 * Instruction-rule audit — which of the rules your agents are TOLD to follow are actually ENFORCED?
 *
 * Agent instruction files (CLAUDE.md, AGENTS.md, .cursor/rules, copilot-instructions…) are prose.
 * Compliance with prose is probabilistic, and studies of public CLAUDE.md files found only a small
 * fraction of their rules backed by any real control. This audit reads the repo's instruction files,
 * extracts the imperative rules, and classifies each one:
 *
 *   enforced   — a Hivelore sensor already refuses (or flags) the violation at commit time;
 *   checkable  — names something mechanical (a code token, a path, a command, an API) — a sensor or
 *                checklist could enforce it, but nothing does yet;
 *   judgment   — behavioral guidance a deterministic check cannot decide (stays prose, legitimately).
 *
 * Pure — the caller reads the files. Heuristic by design and says so; it never edits anything.
 */

export interface InstructionFile {
  path: string;
  content: string;
}

export interface AuditSensor {
  id: string;
  message: string;
  pattern?: string;
  severity: "warn" | "block";
}

export type RuleClass = "enforced" | "checkable" | "judgment";

export interface AuditedRule {
  file: string;
  line: number;
  text: string;
  class: RuleClass;
  /** The sensor that enforces it (class=enforced). */
  sensor_id?: string;
  /** What made it look mechanically checkable (class=checkable). */
  signals?: string[];
}

export interface RulesAudit {
  files: string[];
  rules: AuditedRule[];
  counts: Record<RuleClass, number>;
  /** enforced / (enforced + checkable): how much of what COULD be enforced IS enforced. */
  enforceable_coverage: number | null;
  note: string;
}

/** Instruction files agents read, relative to the repo root. Directories are scanned for .md/.mdc. */
export const INSTRUCTION_FILE_CANDIDATES = [
  "CLAUDE.md",
  "AGENTS.md",
  "GEMINI.md",
  ".github/copilot-instructions.md",
  ".windsurfrules",
  ".clinerules",
  ".cursorrules",
  "CONVENTIONS.md",
  ".cursor/rules",
  ".github/instructions",
  ".claude/rules",
];

const IMPERATIVE =
  /\b(never|always|must|must not|mustn't|do not|don't|avoid|forbidden|prohibited|required|only use|prefer|shall|ne (?:jamais|pas)|toujours|interdit|obligatoire|doit|évite[rz]?)\b/i;

const MANAGED_SENSORS_START = /<!--\s*(?:haive|hivelore):sensors-start\s*-->/;
const MANAGED_SENSORS_END = /<!--\s*(?:haive|hivelore):sensors-end\s*-->/;
const MANAGED_ANY_START = /<!--\s*(?:haive|hivelore):[a-z-]+-start\s*-->/;
const MANAGED_ANY_END = /<!--\s*(?:haive|hivelore):[a-z-]+-end\s*-->/;

const STOP = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are", "be", "it", "this", "that",
  "with", "as", "by", "at", "from", "use", "never", "always", "must", "not", "do", "don't", "avoid", "any",
  "all", "when", "before", "after", "instead", "only", "your", "you", "we", "our", "le", "la", "les", "de",
  "des", "du", "un", "une", "et", "ou", "pas", "ne", "jamais", "toujours",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text.toLowerCase().replace(/[`*_>#()[\]{}"',.:;!?]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]{2,80})`/g)].map((m) => m[1]!.trim());
}

/** Signals that a rule names something a deterministic check could look for. */
export function checkableSignals(text: string): string[] {
  const signals: string[] = [];
  if (backticked(text).length > 0) signals.push("code token");
  // A path needs two separators or a file extension: "read/search" and "contract/API" are prose.
  if (/(?:^|[\s`(])(?:\.{1,2}\/|\/)?[\w.-]+\/[\w.-]+\/[\w./*-]*/.test(text) || /\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rb|rs|sql|ya?ml|json|toml|sh|env|lock)\b/.test(text)) signals.push("path");
  if (/\b(?:npm|pnpm|yarn|npx|git|docker|kubectl|terraform|pip|cargo|go|mvn|gradle|make)\s+[a-z-]+/.test(text)) signals.push("command");
  if (/\b[a-z]+[A-Z][A-Za-z]+\b|\b[A-Z][a-z]+[A-Z]\w+\b|\b\w+\.\w+\(|\b[a-z]+_[a-z_]+\b/.test(text)) signals.push("identifier");
  if (/\b(?:import\s|require\(|console\.log|eval\(|: ?any\b|TODO\b|secrets?\b|passwords?\b|api[_ -]?keys?\b|localhost\b|http:\/\/)/i.test(text)) signals.push("pattern");
  return signals;
}

function matchSensor(text: string, sensors: AuditSensor[]): AuditSensor | undefined {
  const ruleTokens = tokens(text);
  const ticks = backticked(text).map((t) => t.toLowerCase());
  let best: { sensor: AuditSensor; score: number } | undefined;
  for (const sensor of sensors) {
    const haystack = `${sensor.message} ${sensor.pattern ?? ""}`.toLowerCase();
    // A backticked word proves enforcement only when it is specific: `npm publish`, `LocalDate.now()`,
    // `worker-src` — not `release`, which an unrelated sensor's message may well contain.
    if (ticks.some((t) => t.length >= 4 && /[^A-Za-z]|[a-z][A-Z]/.test(t) && haystack.includes(t))) return sensor;
    const sensorTokens = tokens(sensor.message);
    if (sensorTokens.size === 0 || ruleTokens.size === 0) continue;
    let shared = 0;
    for (const t of ruleTokens) if (sensorTokens.has(t)) shared++;
    const score = shared / Math.min(ruleTokens.size, sensorTokens.size);
    if (shared >= 3 && score >= 0.5 && (!best || score > best.score)) best = { sensor, score };
  }
  return best?.sensor;
}

function cleanRule(line: string): string {
  return line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^\s*>\s*/, "")
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function auditInstructionRules(files: InstructionFile[], sensors: AuditSensor[]): RulesAudit {
  const rules: AuditedRule[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    let inFence = false;
    let inSensors = false;
    let inManaged = false;
    const lines = file.content.replace(/\r/g, "").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      if (raw.trim().startsWith("```")) { inFence = !inFence; continue; }
      if (inFence) continue;
      if (MANAGED_SENSORS_START.test(raw)) { inSensors = true; continue; }
      if (MANAGED_SENSORS_END.test(raw)) { inSensors = false; continue; }
      if (MANAGED_ANY_START.test(raw)) { inManaged = true; continue; }
      if (MANAGED_ANY_END.test(raw)) { inManaged = false; continue; }
      const trimmed = raw.trim();
      if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("<!--") || trimmed.startsWith("|")) continue;
      const text = cleanRule(raw);
      if (text.length < 12 || text.length > 400) continue;
      // Hivelore's own generated sensor list IS the enforcement — count each entry as enforced.
      if (inSensors) {
        const id = text.match(/\b(\d{4}-\d{2}-\d{2}-[a-z]+-[\w-]+)/)?.[1];
        // The same generated list is mirrored into every bridge file: count each sensor once.
        const dedupe = `sensor:${id ?? text.toLowerCase()}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        rules.push({ file: file.path, line: i + 1, text: text.slice(0, 200), class: "enforced", ...(id ? { sensor_id: id } : {}) });
        continue;
      }
      if (inManaged) continue; // other generated blocks (memory breadcrumbs) are not rules
      if (!IMPERATIVE.test(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const sensor = matchSensor(text, sensors);
      if (sensor) {
        rules.push({ file: file.path, line: i + 1, text: text.slice(0, 200), class: "enforced", sensor_id: sensor.id });
        continue;
      }
      const signals = checkableSignals(text);
      rules.push(signals.length > 0
        ? { file: file.path, line: i + 1, text: text.slice(0, 200), class: "checkable", signals }
        : { file: file.path, line: i + 1, text: text.slice(0, 200), class: "judgment" });
    }
  }
  const counts: Record<RuleClass, number> = { enforced: 0, checkable: 0, judgment: 0 };
  for (const rule of rules) counts[rule.class]++;
  const enforceable = counts.enforced + counts.checkable;
  return {
    files: files.map((f) => f.path),
    rules,
    counts,
    enforceable_coverage: enforceable > 0 ? counts.enforced / enforceable : null,
    note:
      "Heuristic classification. 'checkable' means the rule names something a deterministic check could look for " +
      "(a code token, a path, a command); arm it with a sensor or a checklist so the gate — not the model's " +
      "attention — enforces it. 'judgment' rules legitimately stay prose.",
  };
}

export function renderRulesAudit(audit: RulesAudit, opts: { limit?: number } = {}): string {
  const limit = opts.limit ?? 20;
  const lines: string[] = [];
  const total = audit.rules.length;
  if (audit.files.length === 0) return "No agent instruction files found (CLAUDE.md, AGENTS.md, .cursor/rules, …).";
  lines.push(`Agent instruction rules — ${total} found in ${audit.files.join(", ")}`);
  const pct = audit.enforceable_coverage === null ? "n/a" : `${Math.round(audit.enforceable_coverage * 100)}%`;
  lines.push(
    `  ${audit.counts.enforced} enforced by a gate · ${audit.counts.checkable} checkable but unenforced · ` +
    `${audit.counts.judgment} judgment`,
  );
  lines.push(`  Enforceable coverage: ${pct} of the rules a machine could check are actually checked.`);
  const checkable = audit.rules.filter((r) => r.class === "checkable");
  if (checkable.length > 0) {
    lines.push("", "Checkable but unenforced — the agent may follow these, nothing makes sure it does:");
    for (const rule of checkable.slice(0, limit)) {
      lines.push(`  ${rule.file}:${rule.line}  ${rule.text}`);
      lines.push(`      signals: ${rule.signals!.join(", ")}`);
    }
    if (checkable.length > limit) lines.push(`  …and ${checkable.length - limit} more (--json for all)`);
    lines.push(
      "",
      "Arm one: save it as a memory, then attach a check —",
      "  hivelore memory add --type convention --scope team --rule \"<the rule>\" \"<why>\"",
      "  hivelore sensors propose <memory-id> --pattern '<regex for the violation>'      # code shape",
      "  hivelore sensors propose <memory-id> --kind checklist --paths <glob> --message '<verification>'",
    );
  }
  lines.push("", audit.note);
  return lines.join("\n");
}
