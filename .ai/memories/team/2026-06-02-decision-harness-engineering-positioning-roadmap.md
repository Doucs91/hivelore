---
id: 2026-06-02-decision-harness-engineering-positioning-roadmap
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/index.ts
    - packages/mcp/src/server.ts
    - packages/cli/src/index.ts
  symbols: []
tags:
  - strategy
  - roadmap
  - harness-engineering
  - positioning
created_at: '2026-06-02T03:55:39.544Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
## hAIve Positioning in Harness Engineering (2026-06-01 analysis)

Synthesis of 7 sources (Fowler, Anthropic long-running agents, Faros 5-layer, awesome-harness-engineering, NxCode, RedHat, Augment).

### Domain frame
- **Fowler**: harness = everything except the model. Two controls: **guides (feedforward, before action)** + **sensors (feedback, after action)**. Computational (deterministic: lint/test/typecheck) vs inferential (AI). Steering loop: "each error -> durable solution so it never repeats." 3 regulation layers: maintainability (mature), architecture fitness (medium), **behavior (unsolved)**.
- **Faros 5 layers**: 1. tool orchestration 2. verification loops 3. **context & memory** 4. guardrails 5. observability.
- **Anthropic**: repo-native memory (progress files, git as state), incremental work, startup verification.

### Where hAIve sits
Layer 3 (Context & Memory) + steering policy. **Cleanest implementation of the feedback-on-knowledge loop** (`mem_tried` captures, `get_briefing` reinjects). BUT: 1 layer out of 5, and **feedback only, not feedforward**.

### Strengths
Repo-native memory, git-versioned, PR-reviewable, team-shared; typed taxonomy; **negative memory (`mem_tried`)**; enforcement layer; MCP-native; multi-agent coordination; local embeddings; impact measurement; lightweight zero-infra.

### Weaknesses
1 layer out of 5; all feedback and no feedforward; missing behavior harness; mostly soft enforcement (`CLAUDE.md` prose); risk of memory rot/bloat; manual discipline burden; not yet positioned as a portable standard.

### Roadmap (prioritized) - "make hAIve irresistible"
1. **Memory->Guardrail compiler** (killer feature): generate an executable check from a gotcha/convention/attempt (custom lint, fitness function, pre-commit hook). Bridge memory -> feedforward. Nobody does this.
2. **Auto-capture from CI & PR reviews**: a CI failure / PR comment generates a memory automatically.
3. **Harness templates by topology** (Next.js+NestJS, Python...): seed memories+conventions+checks.
4. **Behavior harness**: connect `spec.json`/eval to `mem_tried` -> regression evals.
5. **Automatic memory lifecycle**: decay, confidence, contradictions, dedup/merge, personal->team promotion.
6. **Memory observability dashboard**: extend memory-impact, drift detection.
7. **Hard guardrails**: phase-gating / intent-level beyond prose.
8. **`.ai/` as an open standard**: cross-harness adapters (Cursor, Copilot...).
9. **Progressive context loading**: on-demand fragments (anti-bloat).

### Thesis
hAIve = best repo-native memory + steering policy, but 1 layer out of 5 and feedback-only. To become irresistible: **convert memories into deterministic guides (feedforward)** + **auto-capture CI/PR**. Then hAIve becomes the control plane that closes Fowler's loop instead of leaving it to the human.
