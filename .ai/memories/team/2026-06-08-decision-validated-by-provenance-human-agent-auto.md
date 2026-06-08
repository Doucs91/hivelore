---
id: 2026-06-08-decision-validated-by-provenance-human-agent-auto
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/schema.ts
    - packages/mcp/src/tools/mem-approve.ts
    - packages/cli/src/commands/memory-approve.ts
    - packages/vscode/src/treeProvider.ts
  symbols: []
tags: []
created_at: '2026-06-08T19:43:40.654Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Decision Validated By Provenance Human Agent Auto

Memories carry a `validated_by` provenance field — `"human" | "agent" | "auto" | null` — so a human can tell reviewed knowledge from AI/auto-trusted knowledge. Set at every transition to `status: validated`:

- **human** — explicit human approval via the CLI (`haive memory approve`). The CLI is the human surface.
- **agent** — explicit AI approval via the MCP `mem_approve` tool. MCP is the agent surface.
- **auto** — trusted by a rule WITHOUT review: auto-promotion by read-count/time (get_briefing + `memory auto-promote`), or `defaultStatus: validated` on creation (autopilot). This is the "unreviewed" bucket.
- **null** — not yet validated, or a legacy memory predating the field (the schema default; backward-compatible).

**Why:** by default in autopilot, memories self-validate (1 read / 72h / defaultStatus) with no human review — the human couldn't distinguish what they vetted from what the AI trusted. The marker makes that auditable.

**How to apply:** surfaced in `haive memory list` (✋ human / 🤖 AI / ⚙ auto) and in the VSCode "Context Policy" view (badge + tooltip line, plus a dedicated "🤖 AI-validated — review?" group collecting agent/auto memories for human audit). To make human review a real gate rather than after-the-fact, raise `autoPromoteMinReads` / disable autopilot, or mark sensitive memories `requires_human_approval`. See [[2026-06-07-decision-first-agent-bootstrap-gate]].
