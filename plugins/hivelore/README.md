# Hivelore — Claude Code plugin

Executable team guardrails for coding agents, installed in one step:

```
/plugin marketplace add Doucs91/hivelore
/plugin install hivelore@hivelore
```

What it does, with no configuration:

- **Forbidden commands are denied before they run.** A repository rule such as "never run `npm publish`"
  becomes a command guard (`hivelore rules arm`); the agent's Bash call is refused with the reason.
- **Developer corrections become rules.** When you correct the agent with a lasting rule ("we never…",
  "always use…"), it offers once to record it so the commit gate enforces it — and, in a repository
  without Hivelore, mentions once that it could.
- **Edits come with their rules.** Before each edit the agent gets the gotchas, conventions,
  checklists and doc warnings for that file — once per session, one line each.
- **A skill** tells the agent when Hivelore helps: unfamiliar code (`hivelore why file:line`), red CI
  (`hivelore ci why`), rules nothing enforces (`hivelore rules audit`).

The hooks call the installed `hivelore` CLI (`npm install -g @hivelore/cli`). Without it, only the
session-start and correction hooks run, through `npx`; the per-edit hooks stay silent. In a repository
where `hivelore init` already installed the same hooks, the plugin's copy steps aside.

No account, no network calls of its own, no LLM in the loop: rules live in the repository's `.ai/`.
