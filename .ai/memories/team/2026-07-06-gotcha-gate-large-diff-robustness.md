---
id: 2026-07-06-gotcha-gate-large-diff-robustness
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/anti-patterns-check.ts
    - packages/cli/src/commands/sensors.ts
  symbols: []
tags:
  - gate
  - robustness
  - large-diff
  - enforcement
  - performance
created_at: '2026-07-06T15:11:25.602Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Gotcha Gate Large Diff Robustness

A very large staged diff (200k+ lines: staged node_modules, a generated megafile, a lockfile) used to break the pre-commit gate three ways. All fixed in v0.44.1; keep these invariants:

1. **Never `out.push(...block)` when `block` is diff-derived.** The spread passes every element as a call argument and overflows the call-argument limit → `RangeError: Maximum call stack size exceeded`, which the top-level CLI handler swallowed to a bare message and failed the gate CLOSED. `stripAiDirHunks` / `stripTestHunks` (anti-patterns-check.ts) now push element-by-element in a loop. Any new hunk-splitter must too.

2. **`git diff --cached` readers need a large `maxBuffer`.** `stagedDiff` in cli/commands/sensors.ts used `execFile` with the default 1 MB buffer, so `sensors check` failed silently ("git diff --cached failed: stdout maxBuffer length exceeded") on any multi-MB diff — disabling the sensor check on exactly the commits that most need it. Now 256 MB. The gate's own reader (enforce.ts `runCommand`) uses streaming `spawn`, which is unbounded — prefer that pattern for new diff readers.

3. **Fuzzy corroboration (literal + semantic) is capped at `MAX_FUZZY_SCAN_LINES` (20_000 added lines).** Both are review-only (never hard-block) and cost O(added-lines × memories) — 200k lines took ~9 s before the cap, ~1.5 s after. Above the cap they are skipped and `antiPatternsCheck` returns a `notice` (surfaced by the gate as the `precommit-policy-notice` info finding: "did you stage node_modules?"). Anchors (path-based) and sensors (the deterministic block path) are NEVER capped — enforcement strength is unchanged, only the fuzzy surfacing degrades. Found in the 2026-07-06 deep audit.
