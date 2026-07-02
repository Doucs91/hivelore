---
id: 2026-07-02-decision-process-gates-bind-agents-not-humans
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/agent-context.ts
    - packages/cli/src/commands/enforce.ts
    - packages/core/src/config.ts
  symbols: []
tags:
  - enforcement
  - gate
  - human
  - agent-detection
  - ux
created_at: '2026-07-02T16:13:29.961Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Process gates bind agents, not humans (v0.30.1)

**Decision:** at pre-commit/pre-push, when `detectAgentContext` finds no agent-harness env signal and `enforcement.humanCommits` is `relaxed` (default), the four PROCESS gate errors (`briefing-missing`, `session-recap-missing`, `decision-coverage-missing`, `bootstrap-incomplete`) downgrade to warnings. Deterministic findings (`sensor-block`, `precommit-policy-block`, stale anchors, artifacts) are NEVER relaxed, and `--stage ci` is exempt from relaxation entirely.

**Why:** the product promise is "AI changes should not enter the codebase without consulting team knowledge" — process gates encode the AGENT workflow contract. A human committing by hand is the trusted author of that knowledge; blocking them at 65% for a missing briefing marker (observed in the 0.30.0 field test) just teaches them `--no-verify`, which then also bypasses the sensors. Relaxing the process tier for humans PROTECTS the deterministic tier's credibility.

**Detection contract (core `detectAgentContext`, pure, env-based):** presence of `HAIVE_SESSION_ID` (hivelore run wrapper — which also exports `HAIVE_AGENT=1`), `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` (Claude Code), `CURSOR_AGENT`, `GEMINI_CLI`, `CODEX_SANDBOX`, `AIDER_MODEL`. Explicit `HAIVE_AGENT=1|0` overrides both ways. Env vars propagate into git-hook processes, so the hook sees the same context as the agent shell. Known limit: an unknown harness with no env signature is treated as human — its team should export `HAIVE_AGENT=1` or set `humanCommits: "strict"`.

**Gate header names the actor** (`strict · agent (claude-code)` / `strict · human — process gates relaxed`) so a surprising pass/block is diagnosable at a glance.
