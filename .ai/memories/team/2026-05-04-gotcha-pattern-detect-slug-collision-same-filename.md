---
id: 2026-05-04-gotcha-pattern-detect-slug-collision-same-filename
scope: team
type: gotcha
status: deprecated
anchor:
  paths:
    - packages/mcp/src/tools/pattern-detect.ts
  symbols: []
tags:
  - pattern-detect
  - v0.9.0
  - bug
  - fixed
created_at: '2026-05-04T01:05:45.010Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 1
requires_human_approval: false
---
# pattern_detect creates colliding slugs for same-name files in different directories

> ✅ **Fixed in v0.9.1** - the code now uses `parentDir-baseName` in the CONFIG_CHANGE slug. This gotcha is kept as historical documentation and to prevent regressions.

**Reproduced in v0.9.0**: 3 modifications to `vitest.config.ts` (cli/, core/, embeddings/) produced 3 `config_change` matches with the **same slug** `config-change-vitest-config`. Consequence: identical `id` (date+slug+type), only the first memory file was created, and the other 2 signals were silently lost.

**Code at fault (v0.9.0)**: `packages/mcp/src/tools/pattern-detect.ts` around line 122:
```ts
const slug = path.basename(file)
  .replace(/\.[^.]+$/, "")
  .replace(/[^a-z0-9]/gi, "-")
  .toLowerCase()
  .slice(0, 40);
```
It used only `basename`, not the parent directory.

**Applied fix**:
```ts
const parentDir = path.basename(path.dirname(file));
const baseName = path.basename(file).replace(/\.[^.]+$/, "");
const slug = `${parentDir}-${baseName}`.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
```

**If this regression reappears**: verify that the CONFIG_CHANGE slug includes `parentDir`; otherwise same-name files in different directories produce identical IDs and signals are silently lost.
