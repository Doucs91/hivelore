# hAIve

Team-first persistent memory layer for AI coding agents.

> A blend of *hive* and *AI* — the shared knowledge hive that all your team's AI agents draw from.

## Vision

Three problems hAIve solves:

1. **Redundant onboarding** — N developers means N redundant project analyses by N AI sessions.
2. **Personal memory loss across machines** — the deep understanding an AI gains while working with a developer evaporates as soon as the dev switches machines or closes the session.
3. **No sync of specialized learnings** — each developer's AI gains domain-specific knowledge (e.g. *"field X was removed for legal reasons"*) that never propagates to teammates' AIs.

## Status

**v0.3 — Local embeddings + semantic search (current)** — every v0.1 + v0.2 capability plus a local embeddings index (Transformers.js, `bge-small-en-v1.5`, runs entirely on the developer's machine) and a `semantic` mode for `mem_search`. Confidence levels and the memory-PR workflow arrive in v0.4.

See [`PLAN.md`](./PLAN.md) for the full roadmap.

## Packages

| Package | Description |
|---|---|
| [`@hiveai/core`](./packages/core) | Types, memory schema, parser/serializer, validation |
| [`@hiveai/cli`](./packages/cli) | CLI (`haive init`, `haive memory …`, `haive mcp`, `haive embeddings …`) |
| [`@hiveai/mcp`](./packages/mcp) | MCP server exposing memory + project context to AI clients |
| [`@hiveai/embeddings`](./packages/embeddings) | Local sentence embeddings (Transformers.js) for semantic search — optional |

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

## MCP server

The MCP server exposes hAIve memory and project context to any MCP-compatible AI client over stdio.

### Tools

| Tool | Purpose |
|---|---|
| `get_briefing` | One-shot onboarding: project context + module contexts + ranked memories under a token budget. Replaces 4–5 separate calls. |
| `code_map` | Browse the pre-computed `.ai/code-map.json` (file → exports + 1-line description) instead of greping. |
| `mem_save` | Save a new memory (defaults to personal scope) |
| `mem_search` | Search memories — literal (multi-word AND) or semantic similarity (`semantic: true`) |
| `mem_list` | List memories with optional filters |
| `mem_for_files` | Surface memories relevant to a set of files (anchor / module / domain) |
| `mem_get` / `mem_delete` / `mem_verify` / `mem_reject` / `mem_pending` / `mem_approve` | Memory lifecycle operations |
| `get_project_context` | Read `.ai/project-context.md` directly (without budgeting) |
| `bootstrap_project_save` | Persist a project (or module) context document analyzed by the AI |

### Prompts

| Prompt | Purpose |
|---|---|
| `bootstrap_project` | Instructions for the AI client to analyze the project and call `bootstrap_project_save` |

### Client configuration examples

After `haive init` in your project, point your AI client at the `haive-mcp` binary.

**Claude Code** (`~/.claude.json` or per-project `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "haive": {
      "command": "haive-mcp",
      "args": ["--root", "/absolute/path/to/your/project"]
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "haive": {
      "command": "haive-mcp",
      "args": ["--root", "/absolute/path/to/your/project"]
    }
  }
}
```

**VS Code** (`code --add-mcp`):

```bash
code --add-mcp '{"name":"haive","command":"haive-mcp","args":["--root","/absolute/path/to/your/project"]}'
```

**Project-scoped (Claude Code, auto-detected on open)**: this repo ships a `.mcp.json` at the root that points at `packages/mcp/dist/index.js`. Open the project in Claude Code, accept the MCP server prompt, and `mem_save / mem_search / get_project_context` are immediately available.

The project root can also be set via the `HAIVE_PROJECT_ROOT` environment variable, or auto-detected from the nearest `.ai/`, `.git/`, or `package.json`.

## Semantic search (optional, opt-in install)

`@hiveai/embeddings` adds a local embeddings index over your memories using Transformers.js. The model (`Xenova/bge-small-en-v1.5`, 384 dimensions, ~110MB) is downloaded on first use and cached locally — **no data leaves your machine**.

It is **not installed by default** because Transformers.js pulls in heavy ML/native dependencies (onnxruntime, sharp, …). Install it explicitly only if you want semantic search:

```bash
npm install @hiveai/embeddings
# or: pnpm add @hiveai/embeddings
```

Then:

```bash
# Build (or refresh) the embeddings index. First run downloads the model (~110MB).
haive embeddings index

# Inspect the index
haive embeddings status

# Run a semantic query from the CLI
haive embeddings query "how do we handle retries on payment failures"
```

From an MCP client, set `semantic: true` on `mem_search` to use the embeddings index. If the index is missing or `@hiveai/embeddings` is not installed, `mem_search` gracefully falls back to literal search and returns `mode: "literal_fallback"` with a notice.

The index is stored at `.ai/.cache/embeddings/embeddings-index.json` and is invalidated per-entry by content hash, so re-indexing is fast after edits.

## Sync on merge

Two ways to keep memory state fresh after pulls/merges:

```bash
# Local: install git hooks once. After every pull/merge, hAIve verifies
# anchors, auto-promotes eligible memories, and reports memories that
# changed since ORIG_HEAD.
haive install-hooks

# CI: copy .github/workflows/haive-sync.yml.example into your project's
# .github/workflows/ to run the same on push to main/develop and to
# comment on PRs whose changes would invalidate memories.
```

The `haive sync` command can also be run manually:

```bash
haive sync                    # verify anchors + auto-promote
haive sync --since main       # also report memories changed since main
haive sync --quiet            # minimal output (used by the hooks)
```

## Code map (token reduction)

`haive index code` writes a compact JSON map (`.ai/code-map.json`) of every source file → its exports → 1-line JSDoc description. AIs that ask "where does X live?" can read this map (~30KB for a medium repo) instead of greping. The MCP tool `code_map` exposes it with file/symbol filters.

```bash
haive index code              # rebuild the map
```

## One-shot briefing (token reduction)

The `get_briefing` MCP tool bundles project context + module contexts + ranked relevant memories under a `max_tokens` budget. A typical session does **one** call instead of four, and never blows past the token cap because each section is allocated a share and truncated to fit.

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
