---
id: 2026-07-05-decision-passive-capture-distillation-phase2
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/failure-coverage.ts
    - packages/cli/src/commands/session-end.ts
    - packages/cli/src/commands/sync.ts
  symbols: []
tags:
  - passive-capture
  - observations
  - autopilot
  - excellence-plan
  - v0.41.0
created_at: '2026-07-05T02:40:16.815Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Phase 2 (excellence plan) — passive-capture distillation: the non-obvious choices

1. **Distillation is deterministic templating, never an LLM** — the hook stays bounded (exit 0, no network) and the distiller (`distillFailureObservations`, core/failure-coverage.ts) only clusters by normalized summary, drops exploratory lookups (`ls|find|grep|rg|cat|head|tail|which|stat` prefixes), caps at 3/session. If richer wording is wanted, the reviewing human/agent refines the draft — the machine never invents content.
2. **Auto-drafts are born `proposed`, scope personal, tagged `auto-captured`, and NEVER self-validate**: the 72h time-based auto-approve in sync explicitly skips the tag. A machine-observed lesson has weaker provenance than an agent-written one; requiring an explicit approve is the honesty boundary. They also never carry sensors (propose_sensor remains the sole armed path).
3. **Auto-capture runs BEFORE the autoSessionRecap=false early return** in session-end --auto, so NEXT.md-only setups (this repo!) still get drafts. Retry detection lives at distillation time, not in the observe hook — the hook stays O(1)/append-only (deviation from the spec's phrasing, same outcome).
4. **Dedup is by normalized `# what` heading against existing attempts** plus file-exists no-clobber — re-running session end on the same observations is idempotent. Trap found while testing: the session RECAP body also contains the phrase "auto-captured" (the discoveries note), so any test/filter looking for drafts must match `type: attempt` + the tag, not the phrase.
5. **`hivelore run` feeds the same observations stream** (one failure row when the wrapped agent exits non-zero) so hook-less agents participate; telemetry writes are fire-and-forget and never touch the wrapper's exit code.
