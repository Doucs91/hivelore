# @hiveai/cli

> **hAIve** — team-first persistent memory layer for AI coding agents.

Stop re-explaining your project to every AI session. hAIve stores your team's conventions, architectural decisions, gotchas, and discovered patterns as version-controlled Markdown files. Every AI tool on your team reads the same shared knowledge automatically — via the MCP server, bridge files (CLAUDE.md, .cursorrules, Copilot instructions), or the CLI directly.

---

## Install

```bash
npm install -g @hiveai/cli
```

This installs the `haive` command globally.

> **MCP server**: also install `@hiveai/mcp` to expose memories to Claude Code, Cursor, Copilot, and any MCP-compatible AI client.
> **Semantic search** (optional): install `@hiveai/embeddings` for local embedding-based search (no data leaves your machine).

---

## Quick start

```bash
# 1. Initialize hAIve in your project
cd my-project
haive init

# 2. Start the MCP server (in Claude Code / Cursor MCP config)
haive mcp --root /absolute/path/to/my-project

# 3. Add a team memory
haive memory add \
  --type gotcha \
  --slug "open-in-view-false" \
  --scope team \
  --paths src/main/resources/application.properties \
  --body "spring.jpa.open-in-view=false is intentional — do not re-enable."

# 4. Browse memories
haive memory list --scope team

# 5. Get a briefing before a task
haive briefing --task "add a payment endpoint" --scope team

# 6. Sync after a git pull
haive sync
```

---

## Commands

### `haive init`

Initialize the `.ai/` structure in a project and generate bridge files for your AI tools.

```bash
haive init                    # Creates .ai/, CLAUDE.md, .cursorrules, copilot-instructions.md
haive init --no-bridges       # Skip bridge file generation
haive init --with-ci          # Also write .github/workflows/haive-sync.yml
haive init --dir /other/path  # Initialize in a specific directory
```

**What it creates:**

```
your-project/
├── .ai/
│   ├── project-context.md        # Shared project overview (fill via bootstrap_project MCP prompt)
│   ├── modules/                  # Per-component context files
│   └── memories/
│       ├── personal/             # Private to one developer
│       ├── team/                 # Shared with the whole team (git-committed)
│       └── module/<name>/        # Scoped to a specific module/component
├── CLAUDE.md                     # Bridge for Claude Code (auto-generated)
├── .cursorrules                  # Bridge for Cursor (auto-generated)
└── .github/
    └── copilot-instructions.md   # Bridge for GitHub Copilot (auto-generated)
```

Bridge files include mandatory rules that tell agents to call `post_task` and `mem_tried` before closing a session, so knowledge is captured automatically.

---

### `haive mcp`

Start the hAIve MCP server over stdio. Point your AI client at this binary.

```bash
haive mcp                           # Auto-detect project root
haive mcp --root /path/to/project   # Explicit project root
```

**Claude Code** (`~/.claude.json`):
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

**VS Code**:
```bash
code --add-mcp '{"name":"haive","command":"haive-mcp","args":["--root","/path/to/project"]}'
```

---

### `haive memory`

Manage individual memory entries.

#### `haive memory add`

```bash
haive memory add \
  --type <type> \          # convention | decision | gotcha | architecture | glossary | attempt
  --slug <slug> \          # Short identifier used in the filename
  --scope team \           # personal (default) | team | module
  --title "My title" \     # Optional heading (auto-added to body)
  --tags "auth,jwt" \      # Comma-separated tags
  --domain payments \      # Business domain for relevance scoring
  --paths src/auth.ts \    # Anchor to files (enables staleness detection)
  --symbols JwtFilter \    # Anchor to symbols/functions
  --body "The knowledge."  # Memory content (Markdown)

# Read body from a file (useful for long memories):
haive memory add --type architecture --slug "payment-flow" \
  --body-file docs/payment-architecture.md
```

**Memory types:**

| Type | When to use |
|---|---|
| `convention` | How things are done here: naming, patterns, workflow |
| `decision` | A choice that was made and WHY (tradeoffs, constraints) |
| `gotcha` | Non-obvious behavior, traps, things that surprise newcomers |
| `architecture` | Structural overview of a system or module |
| `glossary` | Domain terms and their meaning in this project |
| `attempt` | Failed approach — prevents the same mistake next session |

#### `haive memory list`

```bash
haive memory list                        # All memories
haive memory list --scope team           # Team memories only
haive memory list --status validated     # Only validated
haive memory list --type gotcha          # Gotchas only
haive memory list --tags auth,jwt        # By tags (AND match)
haive memory list --module payments      # Module-scoped memories
```

#### `haive memory query`

Full-text search across id, tags, and body.

```bash
haive memory query "flyway migration"         # AND search across all tokens
haive memory query "payment mobile wave"      # Falls back to OR if no AND match
haive memory query "jwt" --scope team --limit 5
```

#### `haive memory show`

Print the full body, frontmatter, and usage stats of a memory.

```bash
haive memory show 2025-01-15-gotcha-flyway-strict
```

#### `haive memory update`

Update a memory's body, tags, or anchor without changing its id or history.

```bash
haive memory update <id> --body "Updated content."
haive memory update <id> --tags "auth,jwt,security"
haive memory update <id> --paths src/auth.ts,src/jwt.ts
```

#### `haive memory verify`

Check anchor freshness — detect stale memories when anchored files or symbols have moved.

```bash
haive memory verify           # Check all memories
haive memory verify --id <id> # Check a specific one
haive memory verify --update  # Write stale/validated status back to disk
```

When a file is missing, hAIve searches the project for files with the same basename and suggests possible renames.

#### `haive memory approve` / `promote` / `reject`

Control the memory lifecycle: `draft → proposed → validated` or `rejected`.

```bash
haive memory approve <id>       # Mark as validated
haive memory approve --all      # Bulk-approve all proposed/draft
haive memory promote <id>       # Promote personal → team (status: proposed)
haive memory reject <id> --reason "Outdated after refactor"
```

#### `haive memory tried`

Record a failed approach — the most valuable type of negative knowledge.

```bash
haive memory tried \
  --what "importing gray-matter with ESM dynamic import" \
  --why-failed "gray-matter doesn't export a default; named import required" \
  --instead "import matter from 'gray-matter'" \
  --scope team \
  --paths src/parser.ts
```

Auto-validated (no approval cycle needed). Surfaced first in `get_briefing` so agents see it before making the same mistake.

#### `haive memory import`

Import documentation (README, ADR, wiki page) as memories via the `import_docs` MCP prompt.

```bash
haive memory import --from docs/architecture.md --scope team
```

Prints the MCP `import_docs` invocation to run in your AI client.

#### `haive memory for-files`

Show memories relevant to specific files you're about to edit.

```bash
haive memory for-files src/payments/PaymentService.java src/payments/PaymentController.java
```

#### `haive memory stats` / `hot` / `pending` / `digest`

```bash
haive memory stats     # Usage stats and confidence levels for all memories
haive memory hot       # Most-read unvalidated memories (good promotion candidates)
haive memory pending   # Proposed memories awaiting review

# Generate a Markdown review digest for bulk approval/rejection:
haive memory digest                  # Last 7 days, team scope (prints to stdout)
haive memory digest --days 14        # Last 14 days
haive memory digest --scope all      # All scopes
haive memory digest --out digest.md  # Write to file
```

The digest groups memories by type, shows confidence level (⬜ unverified / 🟡 low / 🟢 trusted / ⭐ authoritative), anchor, read count, and action checkboxes for easy bulk review.

---

### `haive briefing`

Print the full project briefing — project context + relevant memories — in one shot. Use before starting a task.

```bash
haive briefing                                           # Full briefing, team scope
haive briefing --task "add a Stripe payment"             # Filter by task relevance
haive briefing --files src/payments/PaymentService.java  # Filter by files
haive briefing --symbols PaymentService,TenantFilter     # Look up symbol locations in code-map
haive briefing --scope all                               # Include personal memories
haive briefing --include-stale                           # Include stale memories
haive briefing --max-memories 15                         # Show more memories
```

**`--symbols` (requires `haive index code`):** look up where specific symbols are defined across your entire codebase — no grep needed. Returns file, line number, kind (class/interface/function/enum), and JSDoc description for each match.

```
PaymentProvider  src/payments/PaymentProvider.java:12  [interface]  — Abstract payment provider
PaymentProvider  src/frontend/payment.types.ts:4       [enum]       — Mobile payment provider enum
```

---

### `haive sync`

Refresh memory state after a `git pull` or merge.

```bash
haive sync                          # Verify anchors + auto-promote eligible memories
haive sync --since main             # Report memories changed since main
haive sync --inject-bridge          # Inject top memories into CLAUDE.md
haive sync --embed                  # Rebuild embeddings index after sync
haive sync --quiet                  # Minimal output (for git hooks)
```

**What sync does:**
1. Checks every anchored memory: does the file/symbol still exist? → marks `stale` if not
2. Re-validates previously stale memories that are now fresh again
3. Auto-promotes `proposed` memories that have been read enough times
4. Reports a decay warning for memories not read in >90 days
5. Optionally injects the top validated memories into your CLAUDE.md

---

### `haive install-hooks`

Install git hooks so `haive sync` runs automatically after every pull/merge.

```bash
haive install-hooks         # Install post-merge and post-rewrite hooks
haive install-hooks --dir /path/to/project
```

---

### `haive embeddings`

Manage the local semantic search index (requires `@hiveai/embeddings` to be installed).

```bash
haive embeddings index          # Build or refresh the embeddings index
haive embeddings status         # Show index stats (count, last updated, model)
haive embeddings query "how do we handle retries on payment failures"
```

The model (`bge-small-en-v1.5`, ~110MB) is downloaded on first use and cached locally. **No data leaves your machine.**

---

### `haive index`

Build code navigation indexes.

```bash
haive index code        # Build .ai/code-map.json (file → exports + 1-line descriptions)
```

The code map lets AI agents find where a function lives without grepping — dramatically reducing tool calls at the start of a task.

---

### `haive tui`

Interactive terminal dashboard with 3 screens — browse, filter, and manage memories without leaving the terminal.

```bash
haive tui               # Open the TUI
haive tui --dir /path/to/project
```

**Screens (switch with `1` `2` `3`):**

| Screen | Key | What it shows |
|---|---|---|
| Memories | `1` | Full list + preview panel, filter by status (Tab), actions |
| Health | `2` | Stale memories, pending review, anchorless memories |
| Stats | `3` | Top-read memories, decaying (>90d unused), totals by status |

**Actions (in Memories screen):**

| Key | Action |
|---|---|
| `↑` `↓` | Navigate |
| `Tab` | Cycle filter (all / draft / proposed / validated / stale / rejected) |
| `a` | Approve (→ validated) |
| `r` | Reject |
| `p` | Propose (→ proposed) |
| `d` | Delete |
| `q` | Quit |

---

### `haive session end`

Save a structured end-of-session recap. Surfaced automatically at the start of the next session via `get_briefing`.

```bash
haive session end \
  --goal "Add Stripe payment integration" \
  --accomplished "Implemented PaymentService, added tests, deployed to staging" \
  --discoveries "The webhook signature must use the raw request body, not parsed JSON" \
  --files "src/payments/PaymentService.ts,src/payments/webhook.ts" \
  --next "Add retry logic for failed webhooks" \
  --scope team
```

One recap is kept per scope (topic-upsert: `revision_count` increments on each call).

---

## Memory lifecycle

```
haive memory add        → status: draft
haive memory promote    → status: proposed  (personal → team)
haive memory approve    → status: validated
haive sync              → status: stale     (if anchor broken)
haive memory reject     → status: rejected
```

Validated team memories are loaded into every `get_briefing` call and injected into bridge files.

---

## Multi-component projects

For projects with frontend + backend (or microservices), create one module context per component:

```bash
# After haive init, create module context files:
mkdir -p .ai/modules/backend .ai/modules/frontend

cat > .ai/modules/backend/context.md << 'EOF'
# Module: backend
- Spring Boot, Java 17, PostgreSQL
- Always filter by tenantId in every query
- Never modify existing Flyway migrations
EOF

cat > .ai/modules/frontend/context.md << 'EOF'
# Module: frontend
- React 19, TypeScript, TanStack Query
- All API calls go through hooks in features/<domain>/api/
- Env vars must be prefixed with VITE_
EOF
```

`get_briefing` auto-loads the relevant module context based on the files the agent is editing.

---

## Semantic search (optional)

Install `@hiveai/embeddings` for similarity-based memory retrieval:

```bash
npm install -g @hiveai/embeddings
haive embeddings index          # First run downloads the model (~110MB)
haive embeddings query "payment retry logic"
```

From MCP: set `semantic: true` on `mem_search` or `get_briefing`.

---

## License

MIT
