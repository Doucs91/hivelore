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
verified_at: '2026-07-02T05:42:00.273Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Inline auto-promote ignores `autoPromoteMinReads` config and hardcodes default 5

**Reproduced in v0.9.0**: `.ai/haive.config.json` (default autopilot config) contains `"autoPromoteMinReads": 1`. But inline auto-promote in `get-briefing.ts` uses hardcoded `DEFAULT_AUTO_PROMOTE_RULE.minReads` (= 5) without loading config:

```ts
// packages/mcp/src/tools/get-briefing.ts:358-361
const rule = {
  minReads: DEFAULT_AUTO_PROMOTE_RULE.minReads,  // ← hardcoded 5
  maxRejections: DEFAULT_AUTO_PROMOTE_RULE.maxRejections,
};
```

**Impact**: autopilot users expect fast promotion (minReads=1) but do not get it. The "passive validation by usage" verdict promised in 0.9.0 only works at the default threshold, not the configurable threshold.

**Fix**: call `loadConfig(ctx.paths)` at the start and use `config.autoPromoteMinReads ?? DEFAULT_AUTO_PROMOTE_RULE.minReads`.

**Verified e2e**: 5 consecutive briefings on a `proposed` memory make status change to `validated` at iteration 5 (not 1 as expected from autopilot config). The mechanism works, but ignores config.
