# hAIve

> Policy enforcement layer for AI coding agents.
> hAIve makes team knowledge actionable: agents must load the right briefing, respect validated decisions, record failed attempts, and pass Git/CI gates before their changes enter the codebase.

---

## The problem

AI coding agents are powerful, but most teams still rely on advisory docs and prompt conventions:

- "Please read our architecture decisions first."
- "Do not repeat the migration mistake from last sprint."
- "Remember to capture what you learned."
- "Do not merge code that invalidates a team decision."

Those rules are easy to skip. hAIve turns them into workflow policy. It gives agents the right context before work starts, then uses MCP, Git hooks, CI checks, and optional client hooks to make bypassing team knowledge visible or blocking.

---

## How It Works

```
AI agent ──▶ hAIve briefing ──▶ code change ──▶ hAIve Git/CI gate ──▶ merge
                 ▲                         │
                 └──── team decisions, gotchas, failed attempts, anchors
```

1. `haive init` creates `.ai/` policy and knowledge files in your repo.
2. Agents start with `get_briefing`, `haive briefing`, or `haive run -- <agent>` to load the team context.
3. Validated memories capture decisions, gotchas, conventions, and failed attempts as Markdown anchored to code paths/symbols.
4. hAIve verifies anchors and flags stale decisions when code moves.
5. `haive enforce check` and `haive enforce ci` block unsafe workflow states: missing briefing, missing recap, stale important memories, missing decision coverage, visible runtime artifacts, or known anti-patterns.

The memory layer is the substrate. The product promise is enforcement: AI changes should not enter the codebase without consulting the team's current knowledge.

---

## Packages

| Package | Install | Description |
|---|---|---|
| [`@hiveai/cli`](./packages/cli) | `npm i -g @hiveai/cli` | Main product: init, enforce, run agents, briefing, memory, sync, CI/Git hooks |
| [`@hiveai/mcp`](./packages/mcp) | bundled into `@hiveai/cli` | Policy-aware MCP tools for any MCP-compatible agent |
| [`@hiveai/core`](./packages/core) | dependency | Internal: config, memory schema, anchors, policy primitives, token budgets |
| [`@hiveai/embeddings`](./packages/embeddings) | `npm i -g @hiveai/embeddings` | Optional: local semantic ranking for briefings/search |

---

## Install

```bash
npm install -g @hiveai/cli
# Optional: semantic search
npm install -g @hiveai/embeddings
```

---

## Quick start

### 1. Initialize And Enforce Your Project

```bash
cd my-project
haive init              # Creates .ai/, bridge files, MCP config, hooks, CI, code-map
haive enforce install   # Re-apply strict MCP + Git + CI enforcement gates any time
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

### 3. Bootstrap Your Project Context

In your AI client, invoke the `bootstrap_project` MCP prompt. The AI will analyze your codebase and write `.ai/project-context.md`.

### 4. Start Work Through hAIve

```
Use get_briefing with:
  task: "add a Stripe payment integration"
  files: ["src/payments/PaymentService.ts"]
```

The agent gets project context + module contexts + relevant memories in one call.

For CLI agents without blocking hooks, run them through hAIve:

```bash
haive run -- <agent-command> [args...]
```

The wrapper writes a compact briefing file and exports `HAIVE_PROJECT_ROOT`, `HAIVE_SESSION_ID`, and `HAIVE_BRIEFING_FILE`.

### 5. Gate Commits And Pull Requests

```bash
haive enforce status
haive enforce check --stage pre-commit
haive enforce ci
haive benchmark report --dir benchmarks/agent-benchmark
```

Git hooks and CI are the agent-agnostic backstop. Client hooks are helpful, but the workflow gates are what make hAIve portable across agents.

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
        └── haive-enforcement.yml # Required hAIve policy gate
```

---

## MCP tools reference

By default, hAIve now exposes the smaller **enforcement** MCP profile: the tools an agent needs to load team context, save durable policy knowledge, close the session, and check a change before commit. Set `HAIVE_TOOL_PROFILE=full` to expose the legacy full tool surface.

| Tool | Description |
|---|---|
| `get_briefing` | ⭐ Required policy briefing: context + decisions + gotchas + failed attempts + warnings |
| `mem_save` | Save policy knowledge (convention, decision, gotcha, architecture, glossary) |
| `mem_search` | Search by keyword or semantic similarity |
| `mem_verify` | Check anchor freshness; detect stale memories + suggest renames |
| `mem_relevant_to` | Ranked memories for a task when project context is already loaded |
| `pre_commit_check` | Check a diff/paths against known gotchas, decisions, and stale anchors |
| `mem_session_end` | Save the required end-of-session recap for the next agent |

The legacy full profile still includes admin/debug tools such as `mem_tried`, `mem_get`, `mem_update`, `code_map`, timeline, conflict, and runtime journal tools.

---

## Enforcement Score And Decision Coverage

`haive enforce check` now reports an enforcement score. Strict projects can require a minimum score before local gates, Git hooks, or CI pass.

The score includes:

- briefing loaded for the current workflow
- anchored decision/gotcha/convention memories verified against changed files
- relevant decisions surfaced in the latest briefing before commit
- pre-commit policy checks against known anti-patterns and stale anchors
- generated runtime/cache artifacts kept out of Git status

If a changed file is covered by an anchored policy memory but that memory was not in the latest briefing, hAIve reports `decision-coverage-missing`. This is the enforcement layer checking not only "did the agent use hAIve?", but "did it consult the decisions relevant to the files it changed?"

Useful commands:

```bash
haive briefing --files "src/payments.ts" --task "change payment validation"
haive enforce check --stage pre-commit
haive enforce cleanup
```

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
haive enforce install                       # Install strict MCP + Git + CI + client-hook policy gates
haive enforce status                        # Report enforcement posture for this repo
haive enforce check [--stage pre-commit]    # Universal local policy gate
haive enforce ci                            # CI required-check entrypoint
haive run -- <agent command>                # Wrap any CLI agent in a hAIve-enforced session
haive install-hooks                         # Legacy hook installer; now uses blocking hAIve policy gates
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
