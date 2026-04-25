# hAIve

Team-first persistent memory layer for AI coding agents.

> A blend of *hive* and *AI* — the shared knowledge hive that all your team's AI agents draw from.

## Vision

Three problems hAIve solves:

1. **Redundant onboarding** — N developers means N redundant project analyses by N AI sessions.
2. **Personal memory loss across machines** — the deep understanding an AI gains while working with a developer evaporates as soon as the dev switches machines or closes the session.
3. **No sync of specialized learnings** — each developer's AI gains domain-specific knowledge (e.g. *"field X was removed for legal reasons"*) that never propagates to teammates' AIs.

## Status

**v0.1 — Foundations (current)** — monorepo scaffolding, memory format, base CLI. No MCP server or embeddings yet.

See [`PLAN.md`](./PLAN.md) for the full roadmap.

## Packages

| Package | Description |
|---|---|
| [`@haive/core`](./packages/core) | Types, memory schema, parser/serializer, validation |
| [`@haive/cli`](./packages/cli) | CLI (`haive init`, `haive memory add\|list\|query\|promote`) |

## Quick start

```bash
pnpm install
pnpm build

# In any project where you want a shared AI memory layer:
node packages/cli/dist/index.js init --dir /path/to/your/project
node packages/cli/dist/index.js memory add \
  --type convention \
  --slug "use pnpm" \
  --tags tooling \
  --body "Always use pnpm in this project." \
  --dir /path/to/your/project
node packages/cli/dist/index.js memory list --dir /path/to/your/project
```

By default, new memories are scoped to `personal` (v0.1 follows the *Personal first* approach: explicit promotion to `team` via `haive memory promote <id>`).

## Layout

After `haive init`, the target project gets:

```
your-project/
├── .ai/
│   ├── project-context.md     # bootstrap project context (filled later by AI)
│   ├── modules/               # per-module context files
│   └── memories/
│       ├── personal/          # private to a single developer
│       ├── team/              # shared with the whole team
│       └── module/<name>/     # scoped to a module
├── CLAUDE.md                  # bridge for Claude Code (auto-generated)
├── .cursorrules               # bridge for Cursor (auto-generated)
└── .github/
    └── copilot-instructions.md  # bridge for GitHub Copilot (auto-generated)
```

## Development

```bash
pnpm install
pnpm build       # build all packages with tsup
pnpm test        # run vitest across packages
pnpm typecheck   # type-check without emit
```

Requires Node 20 LTS or newer.

## License

MIT (planned — to be added before first publish).
# hAIve
