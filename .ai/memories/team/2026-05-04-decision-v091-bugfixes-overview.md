---
id: 2026-05-04-decision-v091-bugfixes-overview
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/config.ts
  symbols:
    - loadConfig
tags: []
created_at: '2026-05-04T02:44:21.853Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.947Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# v0.9.1 - Fixes for the 4 bugs identified during the v0.9.0 audit

## Fixed Bugs

### Bug #1 - haive-mcp out of sync (CRITICAL)
Fix: added `--version` flag on `haive-mcp`; `haive doctor` detects CLI/MCP mismatch and suggests `npm i -g @hiveai/cli@X @hiveai/mcp@X`.

### Bug #2 - pattern_detect slug collision
Fix: CONFIG_CHANGE slug includes `parentDir-baseName`. This ends collisions for same-name files in different directories.

### Bug #3 - mem_save ignores explicit scope
Fix: made Zod scope `.optional()`; computes `resolvedScope = input.scope ?? config.defaultScope ?? 'personal'` early; uses it for dedup, topic-upsert, and creation.

### Bug #4 - auto-promote ignores autoPromoteMinReads
Fix: `loadConfig()` immediately before the inline auto-promote block; `rule.minReads = cfg.autoPromoteMinReads ?? DEFAULT`.

## Tests
+4 regression tests (140 total). Clean build.
