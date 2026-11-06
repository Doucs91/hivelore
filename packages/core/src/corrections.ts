/**
 * Developer corrections — the highest-signal moment of a session, and the one nobody captured.
 *
 * When a developer tells the agent "no, we never call X here — use Y", that sentence is a team rule
 * stated by the only person entitled to state it. Field reviews found these corrections were the best
 * decisions of a session and ended up nowhere (or in one agent's private store). This module
 * recognises them deterministically in a prompt, so a UserPromptSubmit hook can let the agent offer,
 * once, to turn the rule into something the commit gate enforces.
 *
 * Precision first: a correction needs RULE language that generalises ("we never…", "in this repo…",
 * "always use…", "ne jamais…", "on utilise toujours…") — a one-off instruction for the current task
 * ("don't forget the test", "no, the other file") is not a rule. Pure: no I/O.
 */

export interface UserCorrection {
  /** The sentence that states the rule, whitespace-collapsed, ≤ 240 chars. */
  rule: string;
  /** "repeat" when the developer says they already said it — the strongest signal. */
  strength: "repeat" | "correction" | "rule";
}

/** The developer is pushing back on what the agent did. */
const PUSHBACK = /^(?:no\b|nope\b|non\b|stop\b|arr[êe]te\b|wrong\b|that'?s (?:wrong|not right|incorrect)|c'est (?:faux|pas (?:ça|bon))|pas comme [çc]a|not like that|don'?t do that|ne fais pas [çc]a)/i;
/** The developer says it is not the first time. */
const REPEAT = /\b(?:i (?:already )?told you|again|once more|(?:second|2nd|third|3rd) time|as i said|je (?:te l'ai|t'ai) (?:déjà )?dit|encore une fois|(?:deuxième|2e|troisième|3e) fois|comme je (?:l'ai )?dit)\b/i;
/** Language that turns a remark into a standing rule for the codebase. */
const RULE_LANGUAGE = new RegExp(
  [
    String.raw`\bwe (?:never|always|don'?t|do not|only|must|should never)\b`,
    String.raw`\b(?:in|for) (?:this|our) (?:repo|repository|project|codebase|team)\b`,
    String.raw`\bhere,? we\b`,
    String.raw`^(?:always|never|do not|don'?t) (?:use|call|run|import|commit|push|edit|modify|touch|add|put|write|hardcode|mock|delete|bypass|disable)\b`,
    String.raw`\b(?:must|should) (?:always|never)\b`,
    String.raw`\buse \S+ instead(?: of\b)?`,
    String.raw`\bon (?:n'?)?(?:utilise|fait|appelle|lance|met|écrit) (?:jamais|pas|toujours|que)\b`,
    String.raw`\b(?:ici|dans ce (?:repo|projet|dépôt|code)),? on\b`,
    String.raw`\bil ne faut (?:jamais|pas)\b`,
    String.raw`^(?:ne (?:jamais|pas)|toujours|jamais) (?:utiliser|appeler|lancer|modifier|toucher|commit(?:ter)?|pousser|ajouter|mettre|écrire|mocker|supprimer|désactiver)\b`,
    String.raw`\b(?:utilise|prends|passe par) \S+ (?:à la place|plutôt)\b`,
    String.raw`\b(?:toujours|jamais) (?:utiliser|passer par|appeler|lancer)\b`,
  ].join("|"),
  "i",
);
/** Phrases that look like corrections but are not rules. */
const NOT_A_RULE = /\b(?:never ?mind|no (?:problem|worries|thanks)|non merci|pas (?:de|grave) (?:problème|souci)|don'?t forget|n'oublie pas|don'?t worry|ne t'inquiète)\b/i;

function sentences(prompt: string): string[] {
  return prompt
    .replace(/```[\s\S]*?```/g, " ")
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.replace(/^[\s>*-]+/, "").replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 8);
}

function clip(text: string, max = 240): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Recognise a developer correction that states a lasting rule. Returns null for everything else. */
export function detectUserCorrection(prompt: string): UserCorrection | null {
  const text = prompt.trim();
  if (!text || text.length > 4000) return null; // pasted logs and specs are not corrections
  const parts = sentences(text);
  if (parts.length === 0) return null;
  const pushback = PUSHBACK.test(parts[0]!);
  const repeat = REPEAT.test(text);
  for (const sentence of parts) {
    if (sentence.endsWith("?") || NOT_A_RULE.test(sentence)) continue;
    if (!RULE_LANGUAGE.test(sentence)) continue;
    return { rule: clip(sentence), strength: repeat ? "repeat" : pushback ? "correction" : "rule" };
  }
  return null;
}

/** What the hook tells the agent — one paragraph, an offer to make, never an instruction to write. */
export function correctionNudge(correction: UserCorrection, initialized: boolean): string {
  const head = correction.strength === "repeat"
    ? "Hivelore: the developer is correcting you on something they say they already told you"
    : "Hivelore: the developer just stated a rule";
  const quoted = `"${correction.rule}"`;
  if (!initialized) {
    return `${head}: ${quoted}. Apply it. If it is a lasting rule for this codebase (not a one-off for this task), you may mention ONCE ` +
      "that Hivelore can turn corrections like this into rules the commit gate enforces (`npx @hivelore/cli init`, reversible) — " +
      "offer it, never install it without a yes.";
  }
  return `${head}: ${quoted}. Apply it. If it is a lasting rule for this codebase (not a one-off for this task), offer ONCE to record it ` +
    "so no agent repeats the mistake — on a yes: `hivelore memory add --type convention --scope team --rule \"<the rule in one line>\" " +
    "--verified-by \"developer correction\"`, then arm it with `hivelore rules arm` or `propose_sensor` when it names code or a command.";
}
