<p align="center">
  <a href="https://github.com/Doucs91/hivelore">
    <img src="https://raw.githubusercontent.com/Doucs91/hivelore/main/packages/vscode/media/wordmark.svg" alt="Hivelore" width="240" />
  </a>
</p>

# @hivelore/mcp

> **Hivelore MCP server** - policy-aware briefing and memory tools for MCP-compatible coding-agent harnesses.

The MCP server is how agents load team policy before changing code. By default it exposes a small harness-oriented tool surface: briefing, relevant memories, failed-attempt capture, anchor verification, code-map lookup, and pre-commit checks. Larger maintenance and experimental surfaces are opt-in via `HAIVE_TOOL_PROFILE`.

Hivelore is not just a memory database. The MCP layer participates in context policy: state-changing Hivelore tools require `get_briefing` or `mem_relevant_to` first, so agents cannot silently skip team context while using Hivelore. A lesson captured here (`mem_tried`) can attach a **validated guard** that Git hooks and CI then use to refuse any diff reintroducing the documented mistake — same diff, same verdict, on every machine.

<p align="center">
  <img src="https://raw.githubusercontent.com/Doucs91/hivelore/main/docs/demo/hivelore-demo.gif" alt="A captured lesson attaches a validated guard; the commit that reintroduces the mistake is refused" width="720" />
</p>

---

## Install

**Recommended:** install only `@hivelore/cli`. The MCP server is **bundled** inside the `hivelore` binary — configure clients with `command: "hivelore"` and `args: ["mcp", "--stdio"]` (see `@hivelore/cli` README).

Standalone package (legacy / advanced):

```bash
npm install -g @hivelore/mcp
```

You usually still want the CLI for `hivelore init`, `hivelore sync`, etc.:

```bash
npm install -g @hivelore/cli
```

---

## Quick start

```bash
# 1. Install the CLI
npm install -g @hivelore/cli

# 2. Initialize Hivelore in your project (strict enforcement ON by default)
cd my-project
hivelore init          # .ai/, policy config, hooks, CI workflow, code-map
hivelore enforce install
# hivelore init --manual  # if you want to approve memories yourself

# 3. Point your AI client at the MCP server (see Client configuration below)

# 4. Bootstrap project context — run bootstrap_project prompt in your AI client once

# 5. Start every substantive task with get_briefing or mem_relevant_to
```

---

## Client configuration

### Claude Code

Add to `~/.claude.json` (global) or `.claude/settings.json` (per-project):

```json
{
  "mcpServers": {
    "hivelore": {
      "command": "hivelore",
      "args": ["mcp", "--stdio", "--root", "/absolute/path/to/your/project"]
    }
  }
}
```

### Cursor

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "hivelore": {
      "command": "hivelore",
      "args": ["mcp", "--stdio", "--root", "/absolute/path/to/your/project"]
    }
  }
}
```

### VS Code

```bash
code --add-mcp '{"name":"hivelore","command":"hivelore","args":["mcp","--stdio","--root","/absolute/path/to/project"]}'
```

### Project-scoped (auto-detected)

Add a `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "hivelore": {
      "command": "hivelore",
      "args": ["mcp", "--stdio"],
      "env": { "HAIVE_PROJECT_ROOT": "/absolute/path/to/your/project" }
    }
  }
}
```

The project root can also be set via the `HAIVE_PROJECT_ROOT` environment variable, or auto-detected from the nearest `.ai/`, `.git/`, or `package.json`.

---

## Default MCP Tools

By default, Hivelore runs with `HAIVE_TOOL_PROFILE=enforcement`. This keeps the agent surface small and aligned with the product promise.

Default tools:

- `get_briefing`
- `mem_relevant_to`
- `mem_save`
- `mem_tried`
- `mem_search`
- `mem_get`
- `mem_verify`
- `code_map`
- `pre_commit_check`
- `mem_session_end`

Default prompts:

- `bootstrap_project`
- `post_task`

### Tool Profiles

`HAIVE_TOOL_PROFILE` controls how much Hivelore surface an agent sees:

- `enforcement` (default): compact repo-native context harness for coding agents.
- `maintenance`: adds corpus review, lifecycle, distillation, code-search, and project-context maintenance tools.
- `experimental`: adds exploratory diagnostics such as runtime journal, pattern detection, why-this-file, why-this-decision, and conflict analysis.
- `full`: legacy alias for `experimental`.

Use `maintenance` for human/team stewardship sessions and `experimental` only when you are intentionally working on Hivelore's broader research tooling.

### `get_briefing` ⭐ Start every task with this

One-shot policy briefing: returns project context + module contexts + ranked decisions, gotchas, failed attempts, stale warnings, and setup warnings under a token budget. This is the first call agents should make before substantive edits.

```json
{
  "task": "add a Stripe payment integration",
  "files": ["src/payments/PaymentService.ts"],
  "symbols": ["PaymentService", "TenantFilter"],
  "max_tokens": 8000,
  "max_memories": 8,
  "format": "full",
  "semantic": true
}
```

**Parameters:**

| Parameter | Default | Description |
|---|---|---|
| `task` | — | What you're about to do. Used to rank memories by relevance. |
| `files` | `[]` | Files you're editing. Surfaces memories anchored to these files. |
| `symbols` | `[]` | Symbol names to look up in the code-map (e.g. `["PaymentService"]`). Returns file + line + kind without grepping. Requires `hivelore index code`. |
| `max_tokens` | `8000` | Token budget for the entire response. Sections are truncated to fit. |
| `max_memories` | `8` | Max memories to include. |
| `format` | `"full"` | `"full"` = complete bodies · `"compact"` = 1-line summaries (call `mem_get` for details) |
| `semantic` | `true` | Use embedding-based ranking if `@hivelore/embeddings` is indexed. |
| `include_stale` | `false` | Include stale memories (may be outdated). |
| `track` | `true` | Increment read_count for returned memories. |

**Response includes:**
- `last_session` — most recent `hivelore session end` recap (surfaced first so agents start with fresh context)
- `project_context` — `.ai/project-context.md` (suppressed if still template — `is_template: true`)
- `module_contexts` — relevant `.ai/modules/<name>/context.md` files
- `memories` — ranked memories with `confidence`, `unverified` flag (for draft/proposed), and `match reason`
- `symbol_locations` — file:line:kind results for each requested symbol (from code-map)
- `decay_warnings` — memory IDs not read in >90 days
- `setup_warnings` — actionable warnings (e.g. template project-context, missing init)
- `search_mode` — `"semantic"` | `"literal_fallback"` | `"literal"`

---

### `mem_save`

Save a policy-relevant piece of knowledge. For failed approaches, use `mem_tried` immediately so the next agent sees the trap before repeating it.

> **Autopilot mode:** memories go directly to `validated` with `team` scope by default. No approval cycle.

```json
{
  "type": "gotcha",
  "slug": "open-in-view-false",
  "scope": "team",
  "body": "spring.jpa.open-in-view=false is intentional — do not re-enable. Lazy loading outside transactions causes N+1 queries.",
  "paths": ["src/main/resources/application.properties"],
  "tags": ["spring", "jpa", "performance"],
  "topic": "jpa-config"
}
```

| Parameter | Required | Description |
|---|---|---|
| `type` | ✅ | `convention` · `decision` · `gotcha` · `architecture` · `glossary` |
| `slug` | ✅ | Short kebab-case identifier used in the file name |
| `scope` | — | `personal` (default in manual mode) · `team` · `module` |
| `body` | ✅ | Markdown content of the memory |
| `paths` | — | Source file paths to anchor to — enables staleness detection by `hivelore sync`. **Warning if path doesn't exist.** |
| `symbols` | — | Function/class names to anchor to |
| `tags` | — | Tags for filtering and search |
| `topic` | — | Stable key for upsert: if a memory with this `topic`+`scope` exists, update it in-place (`revision_count++`) |
| `domain` | — | Business domain (e.g. `payments`) |
| `author` | — | Author handle |

**Response:** `{ id, scope, file_path, action: "created"|"updated", warning?, invalid_paths? }`

**Deduplication:** identical body content within the same scope is rejected. Use `mem_update` to modify an existing memory.

---

### `mem_tried` ⭐ Record failures immediately

Record a failed approach. Automatically surfaces first in future `get_briefing` calls so agents don't repeat the same mistake.

```json
{
  "what": "using require() to import gray-matter in an ESM package",
  "why_failed": "The package is ESM-only — require() throws ERR_REQUIRE_ESM",
  "instead": "Use import matter from 'gray-matter' (named default import)",
  "scope": "team",
  "paths": ["src/parser.ts"]
}
```

Auto-validated — no approval cycle needed.

---

### `mem_search`

Search memories by substring or semantic similarity.

```json
{
  "query": "flyway migration",
  "scope": "team",
  "semantic": true,
  "limit": 10
}
```

Falls back to literal search if embeddings are not indexed.

---

### `mem_get`

Fetch a single memory with full body, anchor, confidence, and usage stats.

```json
{ "id": "2025-01-15-gotcha-flyway-strict" }
```

---

### `mem_list`

List memories with optional filters.

```json
{
  "scope": "team",
  "type": "gotcha",
  "status": "validated",
  "tags": ["payments"]
}
```

---

### `mem_for_files`

Given the files you're editing, return relevant memories grouped by reason (anchor overlap, module, domain).

```json
{
  "files": ["src/payments/PaymentService.java", "src/payments/WaveProvider.java"]
}
```

---

### `mem_update`

Update a memory's body, tags, or anchor without changing its id or usage history.

```json
{
  "id": "2025-01-15-gotcha-flyway-strict",
  "body": "Updated explanation...",
  "paths": ["src/main/resources/db/migration"]
}
```

---

### `mem_verify`

Check if anchor paths and symbols still exist in the current code. Detects stale memories and suggests possible renames when files have moved.

```json
{ "id": "2025-01-15-gotcha-flyway-strict", "update": true }
```

---

### `mem_diff`

Compare two memories side-by-side: shows frontmatter fields that differ and lines unique to each body. Useful before merging duplicates.

```json
{ "id_a": "2025-01-15-gotcha-flyway-strict", "id_b": "2025-02-01-decision-flyway-naming" }
```

---

### `mem_session_end`

Save a structured end-of-session recap. Topic-upsert: one recap per scope is kept and updated with `revision_count++`. Automatically surfaced at the top of the next `get_briefing`.

```json
{
  "goal": "Add Stripe payment integration",
  "accomplished": "PaymentService done, tests passing, deployed to staging",
  "discoveries": "Webhook signature requires raw body, not parsed JSON",
  "files_touched": ["src/payments/PaymentService.ts", "src/payments/webhook.ts"],
  "next_steps": "Add retry logic for failed webhooks",
  "scope": "team"
}
```

---

### `mem_observe`

Capture a code-level discovery in structured form (found-while, not a convention or decision).

```json
{
  "file": "src/payments/PaymentService.ts",
  "symbol": "processPayment",
  "observation": "This method calls the external API synchronously — any timeout blocks the entire request thread.",
  "scope": "team"
}
```

---

### `mem_approve` / `mem_reject` / `mem_pending` / `mem_delete`

Lifecycle operations:

```json
{ "id": "2025-01-15-gotcha-flyway-strict" }               // mem_approve
{ "id": "2025-01-15-gotcha-old", "reason": "Outdated" }   // mem_reject
{}                                                          // mem_pending (list all)
{ "id": "2025-01-15-gotcha-old" }                          // mem_delete
```

---

### `get_project_context`

Read `.ai/project-context.md` directly (without token budgeting).

```json
{ "module": "payments" }   // Also loads .ai/modules/payments/context.md
```

---

### `bootstrap_project_save`

Persist a project (or module) context document generated by the AI.

```json
{
  "content": "# Project context\n\n## Architecture\n...",
  "module": "payments"   // Optional: save as .ai/modules/payments/context.md
}
```

---

### `code_map`

Browse the pre-computed code map (file → exports + descriptions) instead of grepping.

```json
{ "query": "payment" }              // Filter by keyword
{ "file": "src/payments" }          // Filter by file prefix
{ "symbol": "PaymentService" }      // Find a specific export
```

Requires `hivelore index code` to be run first.

---

## MCP Prompts

### `post_task` ⭐ Run before closing every session

Post-task reflection checklist. Guides the AI through capturing failed approaches, conventions, decisions, and gotchas before the session ends.

```
Use the post_task prompt with:
  task_summary: "Added Stripe payment integration"
  files_touched: '["src/payments/StripeService.ts", "src/payments/PaymentController.ts"]'
```

### `bootstrap_project`

Instructions for the AI to analyze the current project and save a structured context document to `.ai/project-context.md`. Run once after `hivelore init`.

### `import_docs`

Analyze documentation (README, ADR, wiki page, API spec) and save actionable knowledge as Hivelore memories.

```
Use the import_docs prompt with:
  content: "<full document text>"
  source: "docs/architecture.md"
  scope: "team"
```

The AI extracts up to 10 memories (conventions, decisions, gotchas, architecture) and calls `mem_save` for each.

---

## Memory lifecycle

```
mem_save / mem_tried  → draft (personal) or proposed (team)
mem_approve           → validated
mem_verify            → stale (if anchors broken)
mem_reject            → rejected
```

Validated team memories appear in `get_briefing`. Stale memories are excluded by default (pass `include_stale: true` to override).

---

## License

MIT
