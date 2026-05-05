---
id: 2026-05-04-gotcha-mem-save-scope-overridden-by-defaultscope
scope: team
type: gotcha
status: validated
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
created_at: '2026-05-04T01:05:52.280Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# mem_save ignore le `scope` explicite quand `defaultScope` est défini en config

**Reproduit en v0.9.0** : appel MCP `mem_save({ type:"convention", slug:"x", body:"...", scope:"personal" })` sur un projet où `.ai/haive.config.json` a `"defaultScope":"team"` → la mémoire est créée avec `scope: team` dans `.ai/memories/team/`, **pas** `personal`.

**Impact** : un agent qui veut créer explicitement une mémoire personnelle (e.g. note de debug locale) n'a aucun moyen de bypasser le defaultScope team, et risque de poluer la mémoire d'équipe.

**Fix** : dans `mem-save.ts`, n'appliquer `defaultScope` que si l'argument `scope` n'est pas explicitement passé (input.scope === undefined). Ne pas écraser un scope explicite.

**Test reproduction** :
```js
// klb_express config: { defaultScope: "team", defaultStatus: "validated" }
mem_save({ type:"convention", slug:"test", body:"...", scope:"personal" })
// → file_path includes /team/, frontmatter.scope === "team" (BUG)
```
