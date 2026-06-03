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
verified_at: '2026-06-03T02:37:01.608Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 29
requires_human_approval: false
---
## Goal
Re-tag the old dev-environment workaround memories so the v0.16.0 background down-rank applies to them.

## Accomplished
Done + fixed two issues it surfaced (shipped v0.16.1 → v0.16.2):
- Re-tagged 3 dev-env workaround memories (crosspackage-deps, installing-hiveaicore, npm-install-g) with tooling-debt/dev-workflow. Verified live: install/hot-swap notes now render [background].
- Fixed CLI/MCP ranking drift: haive briefing's own classifier missed isEnvWorkaroundMemory (only had isStackPackSeed) — added it so CLI and MCP agree.
- Fixed an anti-pattern self-match false positive (root cause): editing a memory's own .ai/ file re-emits its documented bad command into the diff and the gate self-matched + hard-blocked. anti-patterns-check now stripAiDirHunks() before literal/semantic matching. +3 unit tests. Proven: the follow-up commit (editing a memory mentioning npm install) passed the gate without --no-verify.
- v0.16.2 version-hygiene bump (two shippable commits in 0.16.1 → protocol needs a fresh version).
All tests pass (core 233 / mcp 115 / cli 67 / embeddings 17). Tagged v0.16.1 + v0.16.2, pushed. All core CI green; sonarqube external-transient. enforce finish 100%.

## Discoveries & surprises
- `haive memory update --tags` REPLACES tags (not append) — must pass the full set.
- The anti-pattern gate self-matched when editing a memory's own backing file — a real defect, now fixed via stripAiDirHunks. Captured as gotcha 2026-06-03-gotcha-antipattern-self-match-on-memory-file-edit (marked FIXED).
- The CLI/MCP ranking drift recurred AGAIN (after the recap-renderer one) — `haive briefing` has its own priority classifier separate from briefing-helpers.classifyMemoryPriority. A SHARED classifier is overdue; every ranking change must touch both until then.
- The release gate correctly rejects a second shippable commit at the same version — splitting one logical release across two commits forces a version bump for the second.
- Two of the three target memories were already tagged dev-workflow/hotswap (already demoted); only crosspackage-deps (read 136x) was genuinely untagged.

## Next steps
Human runs `npm publish` for 0.16.2. Strongly recommended next: extract a SINGLE shared memory-priority classifier used by both get_briefing (briefing-helpers) and haive briefing (briefing.ts) — the drift has now bitten twice (recap renderer, env-workaround rank). Re-run sonarqube when the server is reachable.
