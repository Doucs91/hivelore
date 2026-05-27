# hAIve

**Policy enforcement layer for AI coding agents.**

hAIve makes your team's knowledge actionable: agents load the right context before touching code, respect validated decisions and known gotchas, record failed attempts, and pass Git/CI gates before changes enter the codebase.

[![npm](https://img.shields.io/npm/v/@hiveai/cli?color=blue)](https://www.npmjs.com/package/@hiveai/cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![CI](https://github.com/Doucs91/hAIve/actions/workflows/ci.yml/badge.svg)](https://github.com/Doucs91/hAIve/actions/workflows/ci.yml)

---

## The problem

AI coding agents are powerful — but they forget everything between sessions. Most teams work around this with advisory docs and hope:

- *"Please read our architecture decisions first."*
- *"Don't repeat the migration mistake from last sprint."*
- *"Remember to capture what you learned."*
- *"Don't merge code that invalidates a team decision."*

Those rules are easy to skip. hAIve turns them into **enforced workflow policy**.

---

## How it works

```
AI agent ──▶ hAIve briefing ──▶ code change ──▶ hAIve Git/CI gate ──▶ merge
                  ▲                                       │
                  └── decisions · gotchas · failed attempts · anchors
```

1. `haive init` creates a `.ai/` knowledge layer in your repo.
2. Agents start every session with `get_briefing` — one MCP call that returns context + decisions + gotchas + failed attempts, ranked by relevance.
3. Team knowledge lives as Markdown files anchored to the code paths they describe. When code moves, hAIve detects stale anchors.
4. `haive enforce check` and CI enforcement block unsafe states: missing briefing, stale critical decisions, known anti-patterns, uncaptured session knowledge.

> **The memory layer is the substrate. Enforcement is the product promise.**
> AI changes should not enter the codebase without consulting the team's current knowledge.

---

## Install

```bash
npm install -g @hiveai/cli
# Optional: local semantic search (downloads ~110MB model once)
npm install -g @hiveai/embeddings
```

---

## Quick start

### 1. Initialize your project

```bash
cd my-project
haive init          # Creates .ai/, bridge files, MCP config, hooks, CI template
```

`haive init` now also runs agent setup. It writes project-level MCP configs, records the best available mode, and asks before changing user-level client configs. In non-interactive shells it skips global config and tells you how to finish setup.

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

In your AI client, invoke the `bootstrap_project` MCP prompt. The agent analyzes your codebase and writes `.ai/project-context.md` automatically.

### 4. Start work through hAIve

Every session starts with one call:

```
get_briefing(task: "add a Stripe payment integration", files: ["src/payments/PaymentService.ts"])
```

The agent gets project context + relevant module contexts + ranked memories in one shot — no more grepping to rediscover what the team already knows.

For CLI agents without native MCP, wrap them:

```bash
haive run -- claude --dangerously-skip-permissions -p "$(cat task.md)"
```

Check the selected mode any time:

```bash
haive agent status
haive agent setup          # re-run setup later
haive agent setup --yes    # approve user-level MCP config without prompting
```

### 5. Gate commits and pull requests

```bash
haive enforce install       # Installs Git hooks + CI enforcement template
haive enforce status        # Current enforcement posture
haive enforce check         # Pre-commit policy gate
haive enforce ci            # CI entrypoint (exits 1 on violations)
```

---

## What hAIve enforces

| Gate | What it checks |
|---|---|
| **Briefing loaded** | Agent called `get_briefing` before editing |
| **Decision coverage** | Changed files are covered by anchored decisions in the last briefing |
| **Anti-pattern matching** | Known bad approaches blocked before commit |
| **Stale anchors** | Memories anchored to deleted/moved paths are flagged |
| **Session recap** | Agent captured what it learned before closing |
| **CI enforcement** | Required check blocks merge on any gate failure |

---

## .ai/ directory layout

```
your-project/
├── .ai/
│   ├── project-context.md          # Shared project overview
│   ├── modules/                    # Per-component context files
│   │   ├── backend/context.md
│   │   └── frontend/context.md
│   └── memories/
│       ├── personal/               # Private — gitignored
│       ├── team/                   # Shared — committed to git
│       └── module/<name>/          # Module-scoped memories
├── CLAUDE.md                       # Auto-generated bridge for Claude Code
├── .cursorrules                    # Auto-generated bridge for Cursor
└── .github/
    ├── copilot-instructions.md     # Auto-generated bridge for Copilot
    └── workflows/
        ├── haive-sync.yml          # Anchor verification on merge
        └── haive-enforcement.yml   # Required policy gate
```

---

## Memory types

| Type | Description |
|---|---|
| `decision` | Architectural or design choices the team has locked in |
| `gotcha` | Non-obvious constraints, known footguns, subtle invariants |
| `convention` | Naming, patterns, style rules specific to this codebase |
| `attempt` | Failed approaches — so agents don't repeat them |
| `architecture` | Component boundaries, interfaces, data flow |

All memories can be anchored to file paths and symbol names. When anchored code changes, hAIve flags the memory as potentially stale.

---

## MCP tools reference

| Tool | Description |
|---|---|
| `get_briefing` | ⭐ Project context + decisions + gotchas + ranked memories in one call |
| `mem_save` | Save policy knowledge (decision, gotcha, convention, attempt, architecture) |
| `mem_search` | Full-text or semantic search across memories |
| `mem_relevant_to` | Ranked memories for a task when project context is already loaded |
| `mem_verify` | Check anchor freshness, detect stale memories |
| `pre_commit_check` | Diff against known gotchas, decisions, and stale anchors |
| `mem_session_end` | Save end-of-session recap for the next agent |

Set `HAIVE_TOOL_PROFILE=full` to expose the complete tool surface (admin, debug, timeline, conflict detection).

---

## MCP prompts reference

| Prompt | Description |
|---|---|
| `post_task` | ⭐ Post-task checklist — capture learnings before closing every session |
| `bootstrap_project` | Analyze the codebase and write `.ai/project-context.md` |

---

## Packages

| Package | Install | Description |
|---|---|---|
| [`@hiveai/cli`](./packages/cli) | `npm i -g @hiveai/cli` | Main product: init, enforce, run agents, briefing, memory, sync, CI/Git hooks |
| [`@hiveai/mcp`](./packages/mcp) | bundled into `@hiveai/cli` | Policy-aware MCP server |
| [`@hiveai/core`](./packages/core) | dependency | Types, schema, anchors, policy primitives, token budgets |
| [`@hiveai/embeddings`](./packages/embeddings) | `npm i -g @hiveai/embeddings` | Optional: local semantic ranking (bge-small-en-v1.5, fully offline) |

---

## Benchmark results

Measured on a large Next.js + NestJS monorepo (692 Java + 1 411 TS files), 4 parallel agents, same tasks with and without hAIve:

| Metric | Without hAIve | With hAIve | Delta |
|---|---|---|---|
| Tokens consumed | 94 559 | 81 146 | **−14%** |
| Tool calls | 57 | 17 | **−70%** |
| Total duration | 2 min 45 s | 1 min 44 s | **−36%** |
| Files read | 23 | 6 | **−74%** |
| First-pass correctness | ✓ | ✓ | — |

> The main gain isn't token savings — it's eliminating the **exploration overhead**. Agents with hAIve arrive at the right file, with the right pattern, on the first attempt.

---

## CLI reference

```bash
# Setup
haive init [--with-ci] [--no-bridges]        # Initialize .ai/ + bridge files
haive enforce install                         # Install Git hooks + CI enforcement
haive enforce status                          # Enforcement posture report
haive index code                              # Build .ai/code-map.json

# Daily use
haive briefing [--task <text>] [--files]     # Print context + relevant memories
haive run -- <agent command>                  # Wrap any CLI agent in hAIve session
haive enforce check [--stage pre-commit]      # Policy gate
haive enforce ci                              # CI entrypoint
haive sync [--since <ref>] [--embed]          # Verify anchors + auto-promote

# Memory
haive memory add --type <type>                # Add a memory
haive memory list [--scope] [--status]        # List memories
haive memory query <text>                     # Full-text search
haive memory approve [<id>|--all]             # Mark as validated
haive memory promote <id>                     # personal → team
haive memory tried                            # Record a failed approach
haive memory verify [--update]                # Check anchor freshness
haive memory import --from <file>             # Import docs as memories

# Semantic search
haive embeddings index                        # Build index (first run: downloads model)
haive embeddings query <text>                 # Semantic search

# Diagnostics
haive doctor                                  # Analyze setup, emit recommendations
haive tui                                     # Interactive terminal dashboard
haive bench                                   # Self-test MCP tools
```

---

## Multi-component projects

For projects with multiple components (frontend/backend/microservices), create one module context per component. `get_briefing` auto-loads the relevant module context based on the files being edited.

```bash
mkdir -p .ai/modules/backend .ai/modules/frontend

cat > .ai/modules/backend/context.md << 'EOF'
# Module: backend
- Spring Boot, Java 17, PostgreSQL
- Always filter by tenantId in every repository query
- Never modify existing Flyway migrations — create V{N+1}__desc.sql
EOF

cat > .ai/modules/frontend/context.md << 'EOF'
# Module: frontend
- React 19, TypeScript, TanStack Query v5
- All API calls go through hooks in features/<domain>/api/
- Env vars must start with VITE_ to be exposed to the client
EOF
```

---

## Development

```bash
git clone https://github.com/Doucs91/hAIve.git
cd hAIve
pnpm install
pnpm -r build    # Build all packages
pnpm -r test     # Run tests
```

Requires Node 20 LTS+, pnpm 9+.

---

## Contributing

Issues and PRs are welcome. Please open an issue before starting significant work so we can align on direction.

---

## License

Apache 2.0 — see [LICENSE](./LICENSE).
