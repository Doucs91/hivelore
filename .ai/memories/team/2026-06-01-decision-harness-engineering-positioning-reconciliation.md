---
id: 2026-06-01-decision-harness-engineering-positioning-reconciliation
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/usage.ts
    - packages/core/src/relevance.ts
    - packages/core/src/confidence.ts
    - docs/PHASE-2-HANDOFF.md
  symbols: []
tags:
  - roadmap
  - harness-engineering
  - positioning
  - memory-impact
created_at: '2026-06-01T23:18:50.271Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Harness-engineering positioning — A–H reconciliation & roadmap

Source: research on "harness engineering" (Fowler `martinfowler.com/articles/harness-engineering.html`, LangChain "Your harness, your memory", HumanLayer, Augment, Addy Osmani, awesome-harness-engineering). hAIve owns the **feedforward × (context & memory)** quadrant and, since Phase 1 sensors, part of **feedback × computational**. See [[2026-06-01-decision-phase2-sensors-continuation]].

8 candidate ideas were assessed against the ACTUAL codebase (2026-06-01, v0.10.9). Most already exist — only **A** was a real gap.

| Idea | State | Where |
|------|-------|-------|
| A — closed-loop memory-utility scoring (outcome→impact→prune→ranking) | **MISSING → being built** | `usage.ts` tracked reads/rejections only; `relevance.ts` ignored usage; no impact metric |
| B — JIT context assembly | EXISTS | `token-budget.ts`, `briefing-preset.ts`, get_briefing semantic+budget+presets |
| C — sensor→memory auto | EXISTS (P1/P2) + planned (P3/4 Sonar/SARIF ingest) | `sensors.ts`, `sensor-suggest.ts`, PHASE-2-HANDOFF.md |
| D — hooks-native enforcement | EXISTS | `install-hooks.ts`, `enforce.ts` + `enforce finish`, PreToolUse hook |
| E — eval harness | PARTIAL | `benchmark.ts` (paired haive/plain), `bench.ts` (self-test). No rigorous repeatable delta |
| F — contradiction/evaluator | EXISTS | `mem-conflicts.ts`, `conflict-candidates.ts`, `memory-lint.ts` |
| G — skills/progressive disclosure | PARTIAL | `skill` memory type + presets; no selective-activation bundling |
| H — cross-repo federation | EXISTS | `cross-repo.ts`, `contract-watcher.ts`, `dep-tracker.ts` |

## Decision
Implement **A** now as the genuine net-new layer: a pure `impact.ts` scorer combining reads + applied-outcomes + sensor.last_fired (positive) vs rejections + stale + dormancy (negative) → score/tier/pruneCandidate; an `applied` outcome counter in usage; a `mem_feedback` MCP tool to close the loop; and a `haive memory impact` view. Surfacing impact as a **ranking weight** in get_briefing is the next increment (kept out of this batch to avoid destabilizing the briefing pipeline — see the byId gotcha [[2026-05-02-gotcha-getbriefing-semantic-hits-silently-dropped-byid]]).

**Why:** the field's core principle ("never make the same mistake twice" + measure what helps) requires demonstrated-utility feedback, not just read counts. **How to apply:** future batches = E (rigorous repeatable eval producing a chiffré "+X%"), then G (skill activation). Follow [[2026-05-31-decision-git-sync-protocol-multi-agent]] for versioning; agents never `npm publish`.
