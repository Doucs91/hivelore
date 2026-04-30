# @hiveai/mcp

> **hAIve MCP server** — exposes shared team memory and project context to any MCP-compatible AI client (Claude Code, Cursor, GitHub Copilot, VS Code, etc.)

Connect your AI coding tools to a shared, version-controlled knowledge base. Every convention, architectural decision, and gotcha your team has discovered is surfaced automatically when relevant — no more re-explaining the same things in every session.

---

## Install

```bash
npm install -g @hiveai/mcp
```

Also install the CLI to manage memories:

```bash
npm install -g @hiveai/cli
```

---

## Quick start

```bash
# 1. Initialize hAIve in your project
haive init

# 2. Add your AI client config (see below)
# 3. Ask your AI to call get_briefing before starting any task
```

---

## Client configuration

### Claude Code

Add to `~/.claude.json` (global) or `.claude/settings.json` (per-project):

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

### Cursor

Add to `~/.cursor/mcp.json`:

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

### VS Code

```bash
code --add-mcp '{"name":"haive","command":"haive-mcp","args":["--root","/absolute/path/to/project"]}'
```

### Project-scoped (auto-detected)

Add a `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "haive": {
      "command": "haive-mcp",
      "args": ["--root", "."]
    }
  }
}
```

The project root can also be set via the `HAIVE_PROJECT_ROOT` environment variable, or auto-detected from the nearest `.ai/`, `.git/`, or `package.json`.

---

## MCP Tools

### `get_briefing` ⭐ Start every task with this

One-shot onboarding: returns project context + module contexts + ranked relevant memories under a token budget. Replaces 4–5 separate calls at the start of a session.

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
| `symbols` | `[]` | Symbol names to look up in the code-map (e.g. `["PaymentService"]`). Returns file + line + kind without grepping. Requires `haive index code`. |
| `max_tokens` | `8000` | Token budget for the entire response. Sections are truncated to fit. |
| `max_memories` | `8` | Max memories to include. |
| `format` | `"full"` | `"full"` = complete bodies · `"compact"` = 1-line summaries (call `mem_get` for details) |
| `semantic` | `true` | Use embedding-based ranking if `@hiveai/embeddings` is indexed. |
| `include_stale` | `false` | Include stale memories (may be outdated). |
| `track` | `true` | Increment read_count for returned memories. |

**Response includes:**
- `last_session` — most recent `haive session end` recap (surfaced first so agents start with fresh context)
- `project_context` — `.ai/project-context.md` (suppressed if still template — `is_template: true`)
- `module_contexts` — relevant `.ai/modules/<name>/context.md` files
- `memories` — ranked memories with `confidence`, `unverified` flag (for draft/proposed), and `match reason`
- `symbol_locations` — file:line:kind results for each requested symbol (from code-map)
- `decay_warnings` — memory IDs not read in >90 days
- `setup_warnings` — actionable warnings (e.g. template project-context, missing init)
- `search_mode` — `"semantic"` | `"literal_fallback"` | `"literal"`

---

### `mem_save`

Save a new memory. For failed approaches, use `mem_tried` instead — it enforces better structure.

```json
{
  "type": "gotcha",
  "slug": "open-in-view-false",
  "scope": "team",
  "body": "spring.jpa.open-in-view=false is intentional — do not re-enable. Lazy loading outside transactions causes N+1 queries.",
  "paths": ["src/main/resources/application.properties"],
  "tags": ["spring", "jpa", "performance"]
}
```

| Parameter | Required | Description |
|---|---|---|
| `type` | ✅ | `convention` · `decision` · `gotcha` · `architecture` · `glossary` |
| `slug` | ✅ | Short kebab-case identifier |
| `scope` | — | `personal` (default) · `team` · `module` |
| `body` | ✅ | Markdown content |
| `paths` | — | File paths to anchor to (enables staleness detection). **Warning returned if path doesn't exist in project.** |
| `symbols` | — | Function/class names to anchor to |
| `tags` | — | Tags for filtering |
| `topic` | — | Stable key for upsert: if a memory with this `topic`+`scope` already exists, it is updated in-place (`revision_count++`) |
| `domain` | — | Business domain (e.g. `payments`) |
| `author` | — | Author handle |

**Deduplication:** identical body content (same SHA-256 hash) within the same scope is rejected with an error. Use `mem_update` to modify it instead.

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

Requires `haive index code` to be run first.

---

## MCP Prompts

### `post_task` ⭐ Run before closing every session

Post-task reflection checklist. Guides the AI through capturing failed approaches, conventions, decisions, and gotchas before the session ends.

```
Use the post_task prompt with:
  task_summary: "Added Stripe payment integration"
  files_touched: ["src/payments/StripeService.ts", "src/payments/PaymentController.ts"]
```

### `bootstrap_project`

Instructions for the AI to analyze the current project and save a structured context document to `.ai/project-context.md`. Run once after `haive init`.

### `import_docs`

Analyze documentation (README, ADR, wiki page, API spec) and save actionable knowledge as hAIve memories.

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
