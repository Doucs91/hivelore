---
id: 2026-05-04-gotcha-mem-save-scope-overridden-by-defaultscope
scope: team
type: gotcha
status: deprecated
anchor:
  paths:
    - packages/mcp/src/tools/mem-save.ts
    - packages/core/src/config.ts
  symbols: []
tags:
  - mem_save
  - config
  - v0.9.0
  - bug
  - fixed
created_at: '2026-05-04T01:05:52.280Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.949Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 1
requires_human_approval: false
validated_by: null
---
# mem_save ignores explicit `scope` when `defaultScope` is set in config

> ✅ **Fixed in v0.9.1** - `mem-save.ts` now uses `input.scope ?? haiveConfig.defaultScope ?? "personal"`: explicit scope has priority. This gotcha is kept as historical documentation and to prevent regressions.

**Reproduced in v0.9.0**: MCP call `mem_save({ type:"convention", slug:"x", body:"...", scope:"personal" })` on a project where `.ai/haive.config.json` has `"defaultScope":"team"` created the memory with `scope: team` in `.ai/memories/team/`, **not** `personal`.

**Impact**: an agent that wanted to explicitly create a personal memory (for example a local debug note) had no way to bypass team `defaultScope`, and risked polluting team memory.

**Applied fix** (`mem-save.ts`):
```ts
const resolvedScope = (input.scope ?? haiveConfig.defaultScope ?? "personal") as MemoryScope;
```
The explicit `scope` argument always overrides config `defaultScope`.

**If this regression reappears**: verify that `resolvedScope` is computed with `input.scope ??` first, before `haiveConfig.defaultScope`.
