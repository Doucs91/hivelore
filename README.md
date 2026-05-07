# hAIve

> Team-first persistent memory layer for AI coding agents.
> *A blend of **hive** and **AI** — the shared knowledge hive that all your team's AI agents draw from.*

---

## The problem

When multiple developers each use an AI coding agent on the same project, **every agent starts from zero**. Every session burns tokens re-explaining the same architecture decisions, Flyway conventions, or "don't touch X because of Y" gotchas. Specialized knowledge that one developer's AI discovered never propagates to teammates' AIs.

hAIve fixes this by storing your team's knowledge as version-controlled Markdown files that every AI tool reads automatically.

---

## How it works

```
Developer A's AI  ─┐
Developer B's AI  ─┼──▶  .ai/memories/team/  ──▶  git commit/push  ──▶  shared
Developer C's AI  ─┘
```

1. When an AI discovers something worth remembering (a convention, a decision, a gotcha, a failed approach), it saves a memory with `mem_save` or `mem_tried`.
2. That memory is stored in `.ai/memories/team/` and committed to the repo.
3. On the next `git pull`, every developer's AI loads these memories via `get_briefing` before starting a task.
4. `haive sync` verifies anchors after every merge — memories whose code has moved are flagged as stale automatically.

---

## Packages

| Package | Install | Description |
|---|---|---|
| [`@hiveai/cli`](./packages/cli) | `npm i -g @hiveai/cli` | CLI tool: `haive init`, `haive memory`, `haive sync`, `haive briefing`, TUI dashboard |
| [`@hiveai/mcp`](./packages/mcp) | bundled into `@hiveai/cli` | MCP tools ship inside `haive` (`haive mcp --stdio`). Standalone `haive-mcp` remains optional for legacy configs |
| [`@hiveai/core`](./packages/core) | dependency | Internal: memory schema, parser, verifier, token budget utilities |
| [`@hiveai/embeddings`](./packages/embeddings) | `npm i -g @hiveai/embeddings` | Optional: local semantic search via Transformers.js (no data leaves your machine) |

---

## Install

```bash
npm install -g @hiveai/cli
# Optional: semantic search
npm install -g @hiveai/embeddings
```

---

## Quick start

### 1. Initialize your project

```bash
cd my-project
haive init              # Creates .ai/, CLAUDE.md, .cursorrules, copilot-instructions.md
haive init --with-ci    # Also generates .github/workflows/haive-sync.yml
```

### 2. Connect your AI client

**Claude Code** (`~/.claude.json`):
```json
{
  "mcpServers": {
    "haive": {
      "command": "haive",
      "args": ["mcp", "--stdio", "--root", "/absolute/path/to/my-project"]
    }
  }
}
```

**Cursor** (`~/.cursor/mcp.json`):
```json
{
  "mcpServers": {
    "haive": {
      "command": "haive",
      "args": ["mcp", "--stdio", "--root", "/absolute/path/to/my-project"]
    }
  }
}
```

**VS Code**:
```bash
code --add-mcp '{"name":"haive","command":"haive","args":["mcp","--stdio","--root","/path/to/project"]}'
```

### 3. Bootstrap your project context

In your AI client, invoke the `bootstrap_project` MCP prompt. The AI will analyze your codebase and write `.ai/project-context.md`.

### 4. Start a task — always call `get_briefing` first

```
Use get_briefing with:
  task: "add a Stripe payment integration"
  files: ["src/payments/PaymentService.ts"]
```

The agent gets project context + module contexts + relevant memories in one call.

### 5. Sync after every pull

```bash
haive sync                          # Verify anchors + auto-promote
haive install-hooks                 # Auto-run sync after every git pull/merge
haive sync --embed                  # Also rebuild semantic search index
```

---

## .ai/ directory layout

```
your-project/
├── .ai/
│   ├── project-context.md        # Shared project overview
│   ├── modules/                  # Per-component context files
│   │   ├── backend/
│   │   │   └── context.md        # Backend conventions, patterns, gotchas
│   │   └── frontend/
│   │       └── context.md        # Frontend stack, patterns, env conventions
│   ├── .cache/
│   │   └── embeddings/           # Local embeddings index (not committed)
│   └── memories/
│       ├── personal/             # Private — not committed to git
│       ├── team/                 # Shared — committed to git
│       └── module/
│           └── <name>/           # Module-scoped memories
├── CLAUDE.md                     # Auto-generated bridge for Claude Code
├── .cursorrules                  # Auto-generated bridge for Cursor
└── .github/
    ├── copilot-instructions.md   # Auto-generated bridge for GitHub Copilot
    └── workflows/
        └── haive-sync.yml        # CI sync workflow (haive init --with-ci)
```

---

## MCP tools reference

By default, hAIve now exposes the smaller **enforcement** MCP profile: the tools an agent needs to load team context, avoid repeated mistakes, and check a change before commit. Set `HAIVE_TOOL_PROFILE=full` to expose the legacy full tool surface.

| Tool | Description |
|---|---|
| `get_briefing` | ⭐ One-shot onboarding: project context + module contexts + ranked memories under a token budget |
| `mem_save` | Save a new memory (convention, decision, gotcha, architecture, glossary) |
| `mem_tried` | ⭐ Record a failed approach — surfaces first in future briefings to prevent repeated mistakes |
| `mem_search` | Search by keyword or semantic similarity |
| `mem_get` | Fetch a single memory with full details |
| `mem_update` | Update body, tags, or anchor |
| `mem_verify` | Check anchor freshness; detect stale memories + suggest renames |
| `mem_relevant_to` | Ranked memories for a task when project context is already loaded |
| `code_map` | Browse the pre-computed code map (file → exports) without grepping |
| `pre_commit_check` | Check a diff/paths against known gotchas, decisions, and stale anchors |

## MCP prompts reference

| Prompt | Description |
|---|---|
| `post_task` | ⭐ Post-task checklist — run before closing every session to capture what you learned |
| `bootstrap_project` | Instructions for analyzing the project and writing `.ai/project-context.md` |

`HAIVE_TOOL_PROFILE=full` also exposes advanced lifecycle, import, timeline, conflict, runtime-journal, and diagnostic tools for maintainers.

---

## CLI reference

```bash
haive init [--with-ci] [--no-bridges]       # Initialize .ai/ structure + bridge files
haive mcp [--root <path>]                   # Start MCP server
haive briefing [--task <text>] [--files]    # Print project context + relevant memories
haive sync [--since <ref>] [--embed]        # Verify anchors + auto-promote + decay report
haive install-hooks                         # Auto-run sync after git pull/merge
haive install-hooks claude                  # Enforce briefing before Claude Code edits
haive enforce session-start                 # Hook helper: load briefing + write marker
haive enforce pre-tool-use                  # Hook helper: block edits without briefing
haive tui                                   # Interactive terminal dashboard

haive memory add --type <type> --slug <id>  # Add a memory
haive memory list [--scope] [--status]      # List memories
haive memory query <text>                   # Full-text search
haive memory show <id>                      # Print full memory
haive memory update <id>                    # Update body/tags/anchor
haive memory approve [<id>|--all]           # Mark as validated
haive memory promote <id>                   # personal → team (proposed)
haive memory reject <id>                    # Mark as rejected
haive memory verify [--update]              # Check anchor freshness
haive memory tried                          # Record a failed approach
haive memory import --from <file>           # Import docs as memories
haive memory for-files <files...>           # Memories relevant to files
haive memory stats                          # Usage + confidence stats
haive memory hot                            # Most-read unvalidated memories
haive memory pending                        # Proposed memories awaiting review

haive embeddings index                      # Build semantic search index
haive embeddings query <text>               # Semantic search
haive embeddings status                     # Index stats

haive index code                            # Build .ai/code-map.json
```

---

## Multi-component projects

For projects with frontend + backend (or microservices), create one module context per component. `get_briefing` auto-loads the relevant module context based on the files being edited.

```bash
mkdir -p .ai/modules/backend .ai/modules/frontend

cat > .ai/modules/backend/context.md << 'EOF'
# Module: backend
- Spring Boot, Java 17, PostgreSQL
- Always filter by tenantId in every repository query
- Never modify existing Flyway migrations — create a new V{N+1}__desc.sql
EOF

cat > .ai/modules/frontend/context.md << 'EOF'
# Module: frontend
- React 19, TypeScript, TanStack Query v5
- All API calls go through hooks in features/<domain>/api/
- Env vars must start with VITE_ to be exposed to the client
EOF
```

Use `related_ids` to link backend and frontend memories that describe the same feature from each side:

```bash
haive memory update 2025-01-15-gotcha-payment-backend \
  --related-ids 2025-01-15-convention-payment-frontend
```

---

## Benchmark results (v0.2.8, sandaga-monorepo — 692 Java + 1411 TS files)

| Metric | With hAIve | Without hAIve | Delta |
|---|---|---|---|
| Edit/Write iterations | 7 | 11 | **−36%** fewer corrections |
| Tokens consumed | 81 146 | 94 559 | **−14%** |
| First-pass correctness | Multi-tenant pattern correct | Multi-tenant pattern correct | = |
| Pattern discovery | Immediate (from module context) | 8 extra Bash/grep calls | — |

Without module contexts, agents spend 8+ extra exploration calls to discover patterns the team already knows.

---

## Semantic search (optional)

```bash
npm install -g @hiveai/embeddings
haive embeddings index          # First run: downloads ~110MB model
haive embeddings query "how are payments retried after failure"
```

Model: `bge-small-en-v1.5` (384 dimensions, runs fully locally, no API keys).

---

## Development

```bash
pnpm install
pnpm -r build    # Build all packages
pnpm -r test     # Run tests
```

Requires Node 20 LTS+.

---

## License

MIT
