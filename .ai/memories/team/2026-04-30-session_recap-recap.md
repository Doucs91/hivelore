---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/enforcement.ts
    - packages/core/src/relevance.ts
    - packages/core/src/recap.ts
    - packages/core/src/index.ts
    - packages/cli/src/commands/observe.ts
    - packages/cli/src/commands/briefing.ts
    - packages/cli/src/commands/enforce.ts
    - packages/mcp/src/tools/briefing-helpers.ts
    - packages/mcp/src/tools/get-briefing.ts
    - CLAUDE.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-03T01:17:31.645Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 28
requires_human_approval: false
---
## Goal
Fix the 6 real usage friction/noise points I raised after dogfooding hAIve, end-to-end, before adding anything new.

## Accomplished
Shipped v0.16.0 fixing all 6 dogfooding pain points:
1. decision-coverage now ACCUMULATES across briefings (writeBriefingMarker unions memory_ids/files per session) — proven live: this commit passed coverage 19/19 with NO separate broad briefing.
2. failure detection no longer flags grep/pipeline/test/find non-zero exits (observe.detectFailure + isExpectedNonzeroExit, exported+tested).
3. dev-environment workaround memories (dev-workflow/hotswap/dev-env/local-setup/tooling-debt tags) capped at background priority unless anchored (core isEnvWorkaroundMemory + briefing-helpers).
4. auto-generated recaps compacted at briefing top (core recap.ts compactAutoRecapBody) in both get_briefing (MCP) and haive briefing (CLI); broadened detection to catch both "Auto-captured session" and "Edited N files across M tool calls" formats.
5. fixed git-tag push advice (git push origin vX.Y.Z, not --tags) in CLAUDE.md + enforce findings.
3 new core test files (recap, briefing-marker, + cli observe). All 233 core / 112 mcp / 67 cli / 17 embeddings pass. Built, bumped 0.15.0→0.16.0 lockstep, committed e962e52, tagged + pushed with the CORRECT command. All 4 CI workflows green (sonarqube recovered). enforce finish 100%.

## Discoveries & surprises
- The recap compaction needed TWO code paths: the MCP get_briefing tool AND the separate CLI `haive briefing` renderer (briefing.ts:299) render the recap independently. Fixing only one leaves the other noisy. Same will be true for any briefing-presentation change.
- There are (at least) TWO auto-recap formats: session-tracker's "Auto-captured session (N tool calls)" and another "Edited N files across M tool calls". A detector must cover both; the common tell is a raw tool-call count.
- Hot-swap gotcha re-confirmed: the CLI resolves @hiveai/core from the NESTED @hiveai/cli/node_modules/@hiveai/core, not the top-level. A new core export (compactAutoRecapBody) crashed the global CLI until the nested copy was force-updated. Always cp to nested cli→core and mcp→core.
- The SIGPIPE from `cmd | head` makes the upstream command exit non-zero — this is exactly the false-positive class fix #2 targets, and it bit my own smoke test (briefing exit:1 under | head, exit:0 without).
- Accumulation fix validated in-session: coverage went from needing a manual 60-memory briefing (0.15.0) to passing automatically (0.16.0).

## Files touched
- `packages/core/src/enforcement.ts`
- `packages/core/src/relevance.ts`
- `packages/core/src/recap.ts`
- `packages/core/src/index.ts`
- `packages/cli/src/commands/observe.ts`
- `packages/cli/src/commands/briefing.ts`
- `packages/cli/src/commands/enforce.ts`
- `packages/mcp/src/tools/briefing-helpers.ts`
- `packages/mcp/src/tools/get-briefing.ts`
- `CLAUDE.md`

## Next steps
Human runs `npm publish` for 0.16.0. Optional: prune/retag the existing high-read dev-workflow memories with the new env-workaround tags so the down-rank takes effect on them; consider a single shared recap renderer so MCP and CLI never drift again.
