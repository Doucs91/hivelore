---
id: 2026-06-03-decision-init-generates-all-bridges-reach-onboarding
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/commands/init.ts
    - packages/core/src/bridges.ts
    - packages/cli/src/utils/bridge-files.ts
  symbols: []
tags:
  - reach
  - bridges
  - init
  - onboarding
  - competitive
created_at: '2026-06-03T23:18:30.313Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
## `haive init` now generates ALL native bridges (best-in-class reach onboarding)

**Decision (v0.19.0):** `init` generates every supported bridge via the shared `writeBridgeFiles` generator, **after** seeding, so each bridge carries the freshly-seeded repo-specific memories + block sensors instead of an empty template.

Changes:
- init: removed the legacy `writeBridge`/`BRIDGE_BODY` static-template path and the legacy flat `.cursorrules`. Now calls `writeBridgeFiles(root, paths, { targets })` after stack-pack + git seeding. New `--bridge-targets <all|comma-list>` option (default `all`); `--no-bridges` still skips. Keeps the complementary `.cursor/rules/haive-mcp-required.mdc` MCP nudge. First-session report shows a "Reach: N agent bridge(s) generated" line; JSON gains `bridges_written`.
- core `HAIVE_PREAMBLE` (used by every bridge): upgraded from 3 terse lines to the full instructional body (repo map + 4-step "Working through hAIve" + Safety) — so every one of the 12 bridges is genuinely instructive, not just a memory list.

**Why this matters / positioning:** before, a fresh `init` only reached ~4 agents with an empty template — the reach capability (12 targets, shipped v0.18.0) existed but wasn't felt in session 1 (the "adoption-order inversion" risk from [[2026-06-03-decision-competitive-positioning-battle-plan]]). Now out-of-the-box reach = 12 agents, beating memories.sh's "generate per-tool" because ours also carries enforcement (block sensors).

**Design note (intentional):** generic **stack-pack memories are excluded from bridges** (`prepareBridgeData` filters `stack-pack`/`seed` tags). On-thesis: a capable model already knows generic framework best practice; the always-loaded bridge stays focused on repo-specific knowledge + enforced rules. So a brand-new repo's bridges = rich preamble + (empty until repo memories accrue) memory block + block sensors; `haive sync` refreshes them as real memories land. See [[2026-06-03-decision-reach-coldstart-2agent-plan-vs-memories-sh]].

Verified: 528 tests green (core 322, mcp 122, cli 67, embeddings 17), tsc clean, fresh-init smoke generates all 12 with full preamble.
