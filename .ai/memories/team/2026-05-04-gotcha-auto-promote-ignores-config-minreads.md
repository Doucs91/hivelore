---
id: 2026-05-04-gotcha-auto-promote-ignores-config-minreads
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/get-briefing.ts
    - packages/core/src/config.ts
  symbols: []
sensor:
  kind: regex
  pattern: 'minReads\s*:\s*DEFAULT_AUTO_PROMOTE_RULE\.minReads'
  paths:
    - packages/mcp/src/tools/get-briefing.ts
    - packages/core/src/config.ts
  message: >-
    Do not assign `minReads: DEFAULT_AUTO_PROMOTE_RULE.minReads` directly —
    always load config first: `cfg.autoPromoteMinReads ??
    DEFAULT_AUTO_PROMOTE_RULE.minReads`. The hardcoded default ignores the
    user's `autoPromoteMinReads` config.
  severity: warn
  autogen: false
  last_fired: null
tags:
  - auto-promote
  - config
  - v0.9.0
  - bug
created_at: '2026-05-04T01:06:01.101Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.948Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Respect the configured promotion threshold

Load `config.autoPromoteMinReads ?? DEFAULT_AUTO_PROMOTE_RULE.minReads` in both MCP briefing and CLI sync. A regression in v0.9.0 hardcoded five and ignored the configured threshold of one.

Since v0.63 this legacy option name counts **explicit confirmed applications**, not reads. Repeating a briefing must never promote a claim. Preserve the configured threshold while keeping exposure separate from evidence. Regression coverage lives in `packages/mcp/test/tools.test.ts` and `packages/core/test/confidence.test.ts`.
