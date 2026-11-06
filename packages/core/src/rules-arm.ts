/**
 * From prose to gate — turn the checkable rules found by {@link auditInstructionRules} into sensors.
 *
 * `rules audit` tells a team which of its instruction-file rules nothing enforces; this module plans
 * the enforcement, deterministically, for the three shapes a machine can check without guessing:
 *
 *   command    "never run `npm publish`"            → a command guard: the agent's shell call is
 *                                                     denied before it runs (PreToolUse)
 *   path       "never edit `db/migrations/V1.sql`"  → a checklist on that path: a change needs an
 *                                                     explicit acknowledgement at commit time
 *   code       "never call `LocalDate.now()`"       → a regex sensor on added lines
 *
 * Only PROHIBITIONS are armed: "always use X" cannot be checked by matching X. Tokens too generic for a
 * regex (`any`, `log`) are skipped with a reason instead of producing a sensor that cries wolf. The
 * caller validates each plan against the repository before writing anything. Pure: no I/O.
 */
import { commandPattern } from "./command-guards.js";
import type { AuditedRule } from "./rules-audit.js";

export type ArmKind = "command" | "checklist" | "regex";

export interface ArmPlan {
  rule: AuditedRule;
  kind: ArmKind;
  /** command / regex: the pattern to arm. */
  pattern?: string;
  /** checklist: the protected paths. */
  paths?: string[];
  /** Text the sensor MUST fire on (validation). */
  bad_example: string;
  severity: "warn" | "block";
  message: string;
  slug: string;
  /** Why this shape was chosen, in one phrase. */
  reason: string;
}

export interface ArmSkip {
  rule: AuditedRule;
  reason: string;
}

const PROHIBITION = /\b(?:never|do not|don'?t|avoid|must not|mustn'?t|should not|forbidden|prohibited|no longer|ne (?:jamais|pas)|jamais|interdit|évite[rz]?|pas de)\b/i;
const COMMAND_START = /^(?:npm|pnpm|yarn|npx|bun|git|docker|kubectl|terraform|helm|pip3?|poetry|cargo|go|mvn|gradle|make|rm|curl|wget|sudo|chmod|psql|mysql|aws|gcloud|az|gh|vercel|firebase|heroku|fly)\s+\S/;
const BARE_COMMAND = /\b((?:npm|pnpm|yarn|npx|git|docker|kubectl|terraform|helm|cargo|gh)\s+(?:-{1,2}[\w-]+\s+)*[a-z][\w:-]*(?:\s+-{1,2}[\w-]+)*)/g;
const PATH_LIKE = /^(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.*-]+)+$|^[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|java|kt|rb|rs|sql|ya?ml|json|toml|sh|env|lock|conf|tf|md)$/;
const EDIT_VERB = /\b(?:edit|modify|change|touch|rewrite|delete|remove|commit|rename|modifier|toucher|supprimer|éditer|changer)\b/i;

/** The clauses of a rule that carry the prohibition ("Do not use X — it does Y" → "Do not use X"). */
export function prohibitionClauses(text: string): string[] {
  return text
    .split(/(?<=[.;!?])\s+|\s+[—–]\s+|\s+-{1,2}\s+|:\s+(?=[A-Z])/)
    .map((c) => c.trim())
    .filter((c) => c && PROHIBITION.test(c));
}

function backticked(text: string): string[] {
  return [...text.matchAll(/`([^`]{2,80})`/g)].map((m) => m[1]!.trim());
}

function slugFrom(text: string): string {
  return text
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/`[^`]*`/g, (m) => m.replace(/[^a-z0-9]+/g, "-"))
    .replace(/[^a-z0-9]+/g, "-")
    .split("-").filter((w) => w.length > 1 && !["never", "do", "not", "don", "the", "an", "a", "to", "of"].includes(w))
    .slice(0, 6).join("-") || "rule";
}

/** A code token specific enough that matching it is evidence: a call, a member access, a compound name. */
function isSpecificCodeToken(token: string): boolean {
  if (token.length < 4 || /\s{2,}/.test(token)) return false;
  return /[.(:_[\]<>]|[a-z][A-Z]|^[A-Z][a-z]+[A-Z]/.test(token) && !/^https?:/.test(token);
}

function codePattern(token: string): string {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `${/^\w/.test(token) ? "\\b" : ""}${escaped}${/\w$/.test(token) ? "\\b" : ""}`;
}

export function planRuleArming(rules: AuditedRule[]): { plans: ArmPlan[]; skipped: ArmSkip[] } {
  const plans: ArmPlan[] = [];
  const skipped: ArmSkip[] = [];
  for (const rule of rules) {
    if (rule.class !== "checkable") continue;
    const text = rule.text;
    if (!PROHIBITION.test(text)) {
      skipped.push({ rule, reason: "not a prohibition — \"always do X\" cannot be checked by matching X (use a checklist or keep it as guidance)" });
      continue;
    }
    const message = `${text.length > 200 ? `${text.slice(0, 199)}…` : text} (${rule.file}:${rule.line})`;
    const slug = slugFrom(text);
    // Only what the PROHIBITION clause names is forbidden: "`git push` code and the tag. Do not use
    // `git push --tags`" instructs the first command and forbids the second — arming both would block
    // every push. Compound commands (`a && b`) are examples, never a single thing to deny.
    const forbidden = prohibitionClauses(text).join(" ");
    const ticks = backticked(forbidden).filter((t) => !/&&|\|\||;|\|/.test(t));

    // 1. Commands the agent must not run.
    const commands = [
      ...ticks.filter((t) => COMMAND_START.test(t)),
      ...(ticks.some((t) => COMMAND_START.test(t)) ? [] : [...forbidden.matchAll(BARE_COMMAND)].map((m) => m[1]!.trim())),
    ].filter((c, i, all) => all.indexOf(c) === i);
    if (commands.length > 0) {
      const pattern = commands.map(commandPattern).filter(Boolean).map((p) => `(?:${p})`).join("|");
      plans.push({
        rule, kind: "command", pattern, bad_example: commands[0]!, severity: "block", message, slug,
        reason: `names a command (${commands.join(", ")}) — denied before the agent runs it`,
      });
      continue;
    }

    // 2. Files that must not be changed without a deliberate acknowledgement.
    const paths = ticks.filter((t) => PATH_LIKE.test(t) && !t.includes("*") || /\*/.test(t) && t.includes("/"));
    if (paths.length > 0 && EDIT_VERB.test(forbidden)) {
      plans.push({
        rule, kind: "checklist", paths, bad_example: paths[0]!, severity: "warn", message, slug,
        reason: `protects ${paths.join(", ")} — a change must be acknowledged at commit time`,
      });
      continue;
    }

    // 3. Code shapes that must not be introduced.
    const tokens = ticks.filter((t) => !COMMAND_START.test(t) && !PATH_LIKE.test(t));
    const specific = tokens.filter(isSpecificCodeToken);
    if (specific.length > 0) {
      plans.push({
        rule, kind: "regex", pattern: specific.map(codePattern).map((p) => specific.length > 1 ? `(?:${p})` : p).join("|"),
        bad_example: specific[0]!, severity: "warn", message, slug,
        reason: `names code (${specific.join(", ")}) — flagged when a diff adds it`,
      });
      continue;
    }
    skipped.push({
      rule,
      reason: tokens.length > 0
        ? `token${tokens.length > 1 ? "s" : ""} ${tokens.map((t) => `\`${t}\``).join(", ")} too generic for a regex — arm it with an ast sensor (\`sensors propose --kind ast\`)`
        : "no command, protected path or code token to match — keep it as guidance or add a checklist",
    });
  }
  return { plans, skipped };
}
