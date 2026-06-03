---
id: 2026-06-03-decision-competitive-positioning-battle-plan
scope: team
type: decision
status: validated
anchor:
  paths:
    - docs/HAIVE_BATTLE_PLAN_COMPETITIVE_POSITIONING.md
  symbols: []
tags: []
created_at: '2026-06-03T05:00:19.152Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: competitive-positioning
revision_count: 0
requires_human_approval: false
---
## Competitive positioning & battle plan — see docs/HAIVE_BATTLE_PLAN_COMPETITIVE_POSITIONING.md

The consolidated strategy doc lives at `docs/HAIVE_BATTLE_PLAN_COMPETITIVE_POSITIONING.md`. Read it
before any positioning, README, pitch, or scope decision.

**Core thesis:** the market is crowded on memory *sophistication* (least acute need for coding agents)
and nearly empty on **enforced, repo-specific, measured team knowledge** — the deepest, highest-
consequence need. hAIve owns that cell = intersection of memory-banks (AGENTS.md/Cline/memories.sh,
which only inject) × guardrails (fitness functions/NeMo, which only enforce *generic* rules). The loop
capture→brief→**block the repeat**→**measure** is the moat; nobody combines all four.

**Where hAIve stands on REAL needs:** best on enforcement (B) + the loop/measurement (C); competitive
but not dominant on the broadest need, feedforward context (A) — weaker reach (MCP-first) + cold-start;
deliberately behind on raw vector memory (D), which barely costs us.

**Two strategic risks = timing, not shape:** (1) adoption starts upstream (feedforward) where we're
good-not-ahead, but our edge shows downstream (enforcement/measurement) after corpus investment;
(2) enforcement is most acute for *autonomous* agents, still a minority — we're betting on where the
puck is going.

**How we win (priority order):** 1) kill cold-start (auto-seed from git/lint/CI — make value appear in
session #1); 2) widen reach beyond MCP (generate AGENTS.md/.cursorrules/Cline bridges from the same
corpus); 3) make value visible early; 4) ruthlessly kill false positives that train agents to ignore
the gate. Don't fight on vector-memory sophistication — narrowness is a feature.
