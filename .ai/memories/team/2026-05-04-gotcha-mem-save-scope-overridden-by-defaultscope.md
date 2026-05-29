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
  - fixed
created_at: '2026-05-04T01:05:52.280Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 1
requires_human_approval: false
---
# mem_save ignore le `scope` explicite quand `defaultScope` est défini en config

> ✅ **Corrigé en v0.9.1** — `mem-save.ts` utilise maintenant `input.scope ?? haiveConfig.defaultScope ?? "personal"` : le scope explicite a priorité. Ce gotcha est conservé comme documentation historique et pour éviter toute régression.

**Reproduit en v0.9.0** : appel MCP `mem_save({ type:"convention", slug:"x", body:"...", scope:"personal" })` sur un projet où `.ai/haive.config.json` a `"defaultScope":"team"` → la mémoire était créée avec `scope: team` dans `.ai/memories/team/`, **pas** `personal`.

**Impact** : un agent qui veut créer explicitement une mémoire personnelle (e.g. note de debug locale) n'avait aucun moyen de bypasser le defaultScope team, et risquait de polluer la mémoire d'équipe.

**Fix appliqué** (`mem-save.ts`) :
```ts
const resolvedScope = (input.scope ?? haiveConfig.defaultScope ?? "personal") as MemoryScope;
```
L'argument `scope` explicite écrase toujours le `defaultScope` de config.

**Si cette régression réapparaît** : vérifier que `resolvedScope` est calculé avec `input.scope ??` en premier, avant `haiveConfig.defaultScope`.
