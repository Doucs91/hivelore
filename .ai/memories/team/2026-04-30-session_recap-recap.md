---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/relevance.ts
    - packages/mcp/src/tools/get-briefing.ts
    - packages/mcp/src/tools/precommit-check.ts
    - packages/mcp/src/tools/anti-patterns-check.ts
    - packages/cli/src/commands/briefing.ts
    - packages/cli/src/commands/sync.ts
    - packages/cli/src/commands/init.ts
    - packages/cli/src/commands/init-stack-packs.ts
    - packages/mcp/test/tools.test.ts
    - packages/mcp/test/anti-patterns.test.ts
    - CHANGELOG.md
    - CLAUDE.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-05-30T02:29:44.131Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 8
requires_human_approval: false
---
## Goal
Quality pass on hAIve: fix the 5 identified imperfections (A/D/E/G/C) before adding new features, keeping the product high-signal and aligned with harness-engineering positioning.

## Accomplished
- **A — Stack-pack seeds no longer crowd out repo knowledge**: added `STACK_PACK_TAG` + `isStackPackSeed()` in core/relevance.ts; both `classifyMemoryPriority` (mcp/get-briefing.ts) and `classifyCliPriority` (cli/briefing.ts) cap seeds at `background` unless directly anchored to an edited file; seeds tagged `stack-pack` + honest footer; init message corrected; `sync --inject-bridge` excludes seeds.
- **D — Bridge is now a table of contents**: BRIDGE_BODY slimmed to ~22 non-imperative lines; `injectBridge` emits one summary line per memory (new `bridgeSummaryLine`) instead of full bodies. Fresh init CLAUDE.md = 20 lines (was 96); repo CLAUDE.md regenerated 96→53.
- **E — pre_commit_check weighted by file type**: AntiPatternsWarning now carries `tags`/`anchor_paths`; new inverse downgrade in fileTypeDowngradeReason — build/packaging gotchas drop to `info` when no package/build file changed. +2 regression tests.
- **G — MCP get_briefing writes the enforcement briefing marker** (mem_relevant_to inherits it), so MCP-native agents pass the pre-tool-use/pre-commit gate without shelling out to the CLI. +1 regression test.
- **C — dogfooding hygiene**: versions aligned to 0.9.28 (root + 4 packages + project-context); obsolete v0.2.8 draft memory deleted; CHANGELOG 0.9.28 entry added.
- All green: 235 tests pass (+4), typecheck clean, build clean. doctor: repo-root-version-mismatch and stale-draft findings cleared.

## Discoveries & surprises
- **Real coordination defect found by dogfooding**: the MCP `get_briefing` tool did NOT write the enforcement briefing marker — only the CLI `haive briefing` did. So an MCP-native agent calling get_briefing before editing was still blocked by the pre-tool-use gate. This was the genuine "point G" (my original CLI-vs-gate framing was a false alarm: enforce check had run in parallel with briefing, not after). Fixed by writing the marker from getBriefing.
- The `default.json` briefing marker is overwritten per CLI briefing (keyed by session id), so editing two files back-to-back can re-trip the per-file gate — expected, but worth knowing.
- Point E was already half-done: config/docs-only downgrade existed; only the inverse (source-only change vs build-scoped gotcha) was missing.
- Making AntiPatternsWarning.tags/anchor_paths required broke test fixtures — kept them optional with `?? []` fallbacks.
- Bumping to 0.9.28 introduces global/path version-mismatch doctor findings because the globally installed package is still 0.9.27; these are install-state, not code defects, and clear on publish.

## Files touched
- `packages/core/src/relevance.ts`
- `packages/mcp/src/tools/get-briefing.ts`
- `packages/mcp/src/tools/precommit-check.ts`
- `packages/mcp/src/tools/anti-patterns-check.ts`
- `packages/cli/src/commands/briefing.ts`
- `packages/cli/src/commands/sync.ts`
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/init-stack-packs.ts`
- `packages/mcp/test/tools.test.ts`
- `packages/mcp/test/anti-patterns.test.ts`
- `CHANGELOG.md`
- `CLAUDE.md`

## Next steps
Commit (fixes + release) and tag v0.9.28. On publish, run npm i -g @hiveai/cli@0.9.28 @hiveai/mcp@0.9.28 to clear the global version-skew doctor findings. Optional future polish: raise harness-coverage above 34% by anchoring core files; consider per-file briefing markers instead of a single default.json.
