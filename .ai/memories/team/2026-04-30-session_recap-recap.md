---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/core/src/config.ts
    - packages/core/src/context-throttle.ts
    - packages/mcp/src/tools/get-briefing.ts
    - packages/cli/src/commands/dev-link.ts
    - packages/cli/src/commands/sensors.ts
    - packages/mcp/src/server.ts
    - packages/cli/test/cli.test.ts
    - packages/core/test/context-throttle.test.ts
    - CHANGELOG.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-02T21:47:18.594Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 25
requires_human_approval: false
---
## Goal
Make hAIve helpful, not a burden: implement P0-P3 friction fixes — advise-mode pre-edit gate, exclude generated artifacts from decision-coverage, document diff-scan layers, throttle repeated project-context, and a dev-link command.

## Accomplished
Shipped v0.14.0 (minor; core CI green, enforce finish 100%):
- P0: pre-tool-use hook now ADVISES by default — injects the relevant memory via PreToolUse additionalContext and ALLOWS the edit (proven live: my own edits stopped blocking and the memory content appeared as additionalContext). Records the marker so commit coverage accumulates. enforcement.preEditGate:"block" keeps strict mode. decision-coverage now ignores generated .ai artifacts (project-context.md, code-map.json, .cache/.runtime/.usage).
- P1: diff-scan layers documented in-place (sensors check / anti_patterns_check = components, pre_commit_check combines, enforce check = gate).
- P2: new core/context-throttle.ts; get_briefing skips re-emitting an unchanged project context within 8 min (content-hash marker); dedupe_project_context:false forces full.
- P3: `haive dev link` codifies the dist->global hot-swap (nested core/embeddings included) — dogfooded for every rebuild this session.
- Tests: core 193, cli 62 (advise+block pre-tool-use, generated-artifact exclusion), mcp 112. Fix D (0.13.7) also proven live: Sonar connect-timeout was classified external-transient and finish passed.

## Discoveries & surprises
- Claude Code PreToolUse hooks support hookSpecificOutput.additionalContext to inject context WITHOUT blocking (exit 0). This is the mechanism that makes advise-mode zero-friction; the repo previously only used exit-2 blocking + stderr.
- z.infer of a schema field with .default() makes that field REQUIRED in the inferred input type, breaking every literal constructor (mem-relevant-to, session-start, wrapper briefing). Use .optional() for new get_briefing params and default in code.
- Advise-mode marker accumulation gives full commit coverage in a clean single-session agent flow, but a mixed dev session (CLI `haive briefing` runs under a different session id + hook markers) won't fully accumulate — readRecentBriefingMarker picks the freshest single marker. Not a problem for real agent sessions.
- Honest: the Sonar failure on this release was a real connect-timeout (transient), correctly non-blocking via fix D.

## Files touched
- `packages/cli/src/commands/enforce.ts`
- `packages/core/src/config.ts`
- `packages/core/src/context-throttle.ts`
- `packages/mcp/src/tools/get-briefing.ts`
- `packages/cli/src/commands/dev-link.ts`
- `packages/cli/src/commands/sensors.ts`
- `packages/mcp/src/server.ts`
- `packages/cli/test/cli.test.ts`
- `packages/core/test/context-throttle.test.ts`
- `CHANGELOG.md`

## Next steps
Friction P0-P3 done. The harness now surfaces context instead of blocking at edit time, with the commit gate + CI as hard backstops. Possible follow-ups: surface advise-mode injected context counts in the dashboard; consider applying the same content-hash throttle to the session recap; and the broader P1 surface-trim (deprecate genuinely-unused advanced commands) remains a larger curation effort.
