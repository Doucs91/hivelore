---
id: 2026-04-28-decision-v028-features-overview
scope: team
type: decision
status: draft
anchor:
  paths:
    - packages/core/src/schema.ts
    - packages/mcp/src/tools/get-briefing.ts
    - packages/core/src/verifier.ts
  symbols: []
tags:
  - release
  - changelog
  - v0.2.8
created_at: '2026-04-28T16:47:38.556Z'
expires_when: null
verified_at: null
stale_reason: null
---
# v0.2.8 — Memory quality, import, diff, decay & agent ergonomics

## Features added

### Agent ergonomics
- **Auto-capture rule in bridge files**: `haive init` now writes mandatory `post_task` + `mem_tried` instructions into CLAUDE.md/.cursorrules. Agents are forced to call these before saying "Done".
- **`format=compact` in `get_briefing`**: returns id + 1-line summaries. Agents call `mem_get` for full body when needed. Saves tokens on large memory sets.
- **`get_briefing` decay_warnings[]**: lists memories not read in >90 days so agents can review or deprecate them.

### Schema
- `related_ids: string[]` — link memories together. `get_briefing` auto-expands linked memories into the result set.
- `last_read_at` field (used by decay detection).

### Tooling
- **`mem_diff`** MCP tool: compare two memories side-by-side (frontmatter diff + body line diff). Useful before merging duplicates.
- **`import_docs`** MCP prompt: analyze documentation (README, ADR, wiki) and save actionable memories. Max 10 per import.
- **`haive memory import --from <file>`** CLI: wrapper that prints the import_docs invocation.
- **`haive sync --embed`**: rebuilds embeddings index after sync (requires @hiveai/embeddings).
- **`haive init --with-ci`**: writes `.github/workflows/haive-sync.yml`.

### Verifier
- `possibleRenames: string[]` added to `VerifyResult`. When an anchor path is missing, the verifier walks the project tree to find files with the same basename — suggests renames before marking stale.
- Shown in `haive memory verify` output and `mem_verify` MCP tool response.

### Decay
- `isDecaying(usage, createdAt)` helper in core (>90 days unread threshold `DECAY_DAYS = 90`).
- `haive sync` reports decaying memories in non-quiet mode.
