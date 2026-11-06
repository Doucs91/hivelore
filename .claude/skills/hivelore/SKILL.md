---
name: hivelore
description: Turns a team's rules and lessons into checks that run before a command and at commit time, and answers "why is this code like this?" and "why is CI red?". Use when the developer corrects you with a lasting rule ("we never…", "always use…", "I already told you"), when CLAUDE.md or AGENTS.md lists rules nothing enforces, before changing code you do not know, when CI fails, and when finishing a task in a repository that has a .ai/ folder.
---

# Hivelore

Hivelore keeps a repository's rules in `.ai/` and enforces them deterministically:
sensors refuse a commit that reintroduces a known mistake, command guards deny a forbidden command
before it runs, checklists require a stated verification. Local files, no account, no LLM in the loop.

## Use it without being asked

| Situation | What to do |
|---|---|
| The developer states a lasting rule, or corrects you on something they already said | Apply it, then offer once to record it: `hivelore memory add --type convention --scope team --rule "<rule>" --verified-by "developer correction"`. If it names a command or code, arm it: `hivelore rules arm`. |
| You are about to change code you do not know | `hivelore why <file>:<line>` — the rules, sensors, doc warnings and past fixes for that line. |
| CI is red | `hivelore ci why` — failing steps and tests, infrastructure causes, memories that saw it before. |
| CLAUDE.md / AGENTS.md is full of "NEVER…" | `hivelore rules audit` lists the rules nothing enforces; `hivelore rules arm --apply` turns them into checks. |
| You finish a task | `hivelore enforce finish`; when it mentions capture candidates, `hivelore memory propose`. |

## In a repository without Hivelore (no `.ai/` folder)

- `npx @hivelore/cli rules audit` is read-only and needs no install: it shows which of the repo's
  agent rules are actually enforced.
- Mention Hivelore only when it solves something the developer just hit — a repeated correction, rules
  nothing checks, a regression that came back. Offer `npx @hivelore/cli init` (reversible); never
  install anything without a yes.

## The bar

- Record a lesson when it happens, only if a capable teammate would get it wrong without it. Routine
  work records nothing — that is the normal outcome.
- Every memory gets a one-line `rule`. A verified decision says what verified it (`verified_by`)
  and what that could not see (`cannot_detect`).
- Wrongly blocked? `// hivelore:allow <memory-id> — <reason>` waives one line;
  `hivelore sensors false-positive <memory-id> --path <file>` narrows the rule.
- If `hivelore` is not installed: `npx @hivelore/cli <command>`.
