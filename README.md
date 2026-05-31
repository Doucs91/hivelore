# hAIve

**Stop AI agents from reinventing — wrongly — your team's non-obvious decisions.**

A capable model already knows generic best practice. What it *cannot* guess is your team's arbitrary, repo-specific knowledge: that public ids are `id + 100000` prefixed `AC-`, that the status field must be `"OK"`/`"KO"`, that you never edit an applied migration. Left to itself, a confident agent invents a plausible answer — clean, tested, green, and **wrong by policy**. hAIve carries that unguessable knowledge into the task and blocks the change that's about to violate it.

> hAIve's job is not to make agents faster. It's to keep them from confidently reinventing what your team already decided.

[![npm](https://img.shields.io/npm/v/@hiveai/cli?color=blue)](https://www.npmjs.com/package/@hiveai/cli)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![CI](https://github.com/Doucs91/hAIve/actions/workflows/ci.yml/badge.svg)](https://github.com/Doucs91/hAIve/actions/workflows/ci.yml)

---

## The problem

AI coding agents are powerful, but they often act with incomplete repo context. Compaction, parallel sessions, agent switches, and stale advisory docs all create the same failure mode: the agent changes code without carrying the team's current decisions into the work.

Most teams work around this with instructions and hope:

- *"Please read our architecture decisions first."*
- *"Don't repeat the migration mistake from last sprint."*
- *"Remember to capture what you learned."*
- *"Don't merge code that invalidates a team decision."*

Those rules are easy to skip. hAIve turns them into **repo-native context policy**.

---

## How it works

```
AI agent ──▶ hAIve briefing ──▶ code change ──▶ hAIve policy gate ──▶ merge
                  ▲                                       │
                  └── context breadcrumbs · decisions · gotchas · anchors
```

1. `haive init` creates a `.ai/` context policy layer in your repo.
2. Agents start every session with `get_briefing` — one MCP call that returns small default context plus deeper breadcrumbs ranked by task relevance.
3. Decisions, gotchas, failed attempts, and session recaps live as Markdown files anchored to the code paths they describe. When code moves, hAIve detects stale anchors.
4. `haive enforce check` and CI enforcement block unsafe states: missing briefing, stale critical decisions, an anchored anti-pattern your diff is about to repeat, or uncaptured session knowledge.

> **Memory is the substrate. Context enforcement is the product promise.**
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

The agent gets project context + relevant module contexts + ranked context breadcrumbs in one shot — no more grepping to rediscover what the team already knows.

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
| **Briefing loaded** | Agent loaded fresh context breadcrumbs before editing |
| **Decision coverage** | Changed files are covered by relevant anchored decisions in the last briefing |
| **Anti-pattern matching** | Anti-patterns relevant to the diff are surfaced; an anchored, diff-corroborated, high-confidence match **blocks** the commit. Hardness is tunable via `enforcement.antiPatternGate` (`off` · `review` · `anchored` (default) · `strict`) |
| **Stale anchors** | Memories anchored to deleted/moved paths are flagged |
| **Session recap** | Agent captured what changed and what remains before closing |
| **CI enforcement** | Required check blocks merge on any gate failure |

> **What "block" means here.** hAIve's gate is high-precision by design: it hard-blocks the case
> that is almost always a real mistake — an `attempt`/`gotcha` anchored to the exact file you are
> editing, whose warning the diff corroborates. Looser, token-only matches are **surfaced for review**
> rather than blocked, so config/doc commits don't trip on incidental keyword overlap. Tighten or
> loosen this with `enforcement.antiPatternGate`; everything else is enforced as *process* (was the
> context loaded, were decisions surfaced, is the recap present).

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

## Context policy records

| Type | Description |
|---|---|
| `decision` | Architectural or design choices the team has locked in |
| `gotcha` | Non-obvious constraints, known footguns, subtle invariants |
| `convention` | Naming, patterns, style rules specific to this codebase |
| `attempt` | Failed approaches — so agents don't repeat them |
| `architecture` | Component boundaries, interfaces, data flow |

All records can be anchored to file paths and symbol names. When anchored code changes, hAIve flags the record as potentially stale.

---

## MCP tools reference

| Tool | Description |
|---|---|
| `get_briefing` | ⭐ Project context + decisions + gotchas + ranked breadcrumbs in one call |
| `mem_save` | Save repo policy knowledge (decision, gotcha, convention, attempt, architecture) |
| `mem_tried` | Record a failed approach so future agents do not repeat it |
| `mem_search` | Full-text or semantic search across context records |
| `mem_relevant_to` | Ranked context records for a task when project context is already loaded |
| `mem_get` | Fetch one context record after a compact briefing/search result |
| `code_map` | Look up symbols without manual grep when code-map is indexed |
| `mem_verify` | Check anchor freshness, detect stale records |
| `pre_commit_check` | Diff against known gotchas, decisions, and stale anchors |
| `mem_session_end` | Save end-of-session recap for the next agent |

MCP profiles keep the product focused:

- `HAIVE_TOOL_PROFILE=enforcement` (default): compact coding-agent harness.
- `HAIVE_TOOL_PROFILE=maintenance`: corpus review, lifecycle, distillation, code-search, and project-context maintenance.
- `HAIVE_TOOL_PROFILE=experimental`: broader diagnostics such as runtime journal, pattern detection, why-this-file, why-this-decision, and conflict analysis.
- `HAIVE_TOOL_PROFILE=full`: legacy alias for `experimental`.

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

**10 cold sub-agents, 5 projects, the same task with and without hAIve.** Each fixture hides a
policy that is *not* visible in the code; correctness is graded by a hidden rubric the agents never
see. Real token/tool counts from the agent runtime (not a proxy). `n=1` per cell — a characterization,
not a significance test.

**Correctness (did the agent satisfy the hidden policy?)**

| Project | Policy type | Without hAIve | With hAIve |
|---|---|:---:|:---:|
| multitenant (TS) | inferable | ✅ | ✅ |
| money / Decimal (Py) | inferable | ✅ | ✅ |
| migrations (SQL) | inferable | ✅ | ✅ |
| public-id `AC-100007` (TS) | **arbitrary** | ❌ invented `rec_7` | ✅ |
| status `OK`/`KO` (Py) | **arbitrary** | ❌ returned `ok`/`error` | ✅ |
| **Total** | | **3 / 5** | **5 / 5** |

**Cost, split by policy type (real tokens):**

| | Tokens without | Tokens with | Outcome |
|---|---:|---:|---|
| Inferable policies | 31,725 | 63,252 | same answer — hAIve is overhead here |
| Arbitrary policies | 31,325 | 23,143 | hAIve **2/2 vs 0/2**, and **−26% tokens** |

> **Read this honestly.** hAIve does **not** make agents faster or cheaper on tasks a capable model
> can already infer — there it is pure briefing overhead, which is exactly why [adaptive briefing](#adaptive-briefing)
> trims itself to near-zero when nothing team-specific matches. Its value is **correctness on the
> unguessable**: the two failures without hAIve were confident, well-tested, *wrong-by-policy* code.
> On the arbitrary cases hAIve is even cheaper, because the plain agent burns tokens inventing a
> convention (and still gets it wrong).

### Adaptive briefing

Because a briefing only earns its tokens when it carries unguessable knowledge, `get_briefing`
returns `briefing_value: "high" | "low"`. When nothing team-specific matches the files/task, the
auto-generated project context is trimmed to a one-line note (config: `adaptiveBriefing`, default on).
hAIve charges tokens only when it actually knows something the model doesn't.

---

## CLI reference

```bash
# Setup
haive init [--with-ci] [--no-bridges]        # Initialize .ai/ + bridge files
haive enforce install                         # Install Git hooks + CI enforcement
haive enforce status                          # Enforcement posture report
haive index code                              # Build .ai/code-map.json
haive index code --status [--json]            # Report code-map / code-search index freshness

# Daily use
haive briefing [--task <text>] [--files]     # Print context + relevant memories
haive run -- <agent command>                  # Wrap any CLI agent in hAIve session
haive enforce check [--stage pre-commit]      # Policy gate
haive enforce ci                              # CI entrypoint
haive sync [--since <ref>] [--embed]          # Verify anchors + auto-promote

# Memory
haive memory add --type <type> [--paths|--files <csv>]  # Add a memory (anchor to files)
haive memory list [--scope] [--status]        # List memories
haive memory query <text>                     # Full-text search
haive memory approve [<id>|--all]             # Mark as validated
haive memory promote <id>                     # personal → team
haive memory tried                            # Record a failed approach
haive memory verify [--update] [--json]       # Check anchor freshness
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
