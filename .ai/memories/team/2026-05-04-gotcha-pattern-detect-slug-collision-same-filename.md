---
id: 2026-05-04-gotcha-pattern-detect-slug-collision-same-filename
scope: team
type: gotcha
status: validated
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
# pattern_detect produit des slugs collidants pour des fichiers homonymes dans des dossiers différents

> ✅ **Corrigé en v0.9.1** — le code utilise maintenant `parentDir-baseName` dans le slug CONFIG_CHANGE. Ce gotcha est conservé comme documentation historique et pour éviter toute régression.

**Reproduit en v0.9.0** : 3 modifications de `vitest.config.ts` (cli/, core/, embeddings/) → 3 matches `config_change` avec le **même slug** `config-change-vitest-config`. Conséquence : `id` identique (date+slug+type), seul le 1er fichier mémoire est créé, les 2 autres signaux sont silencieusement perdus.

**Code en cause (v0.9.0)** : `packages/mcp/src/tools/pattern-detect.ts` ligne ~122 :
```ts
const slug = path.basename(file)
  .replace(/\.[^.]+$/, "")
  .replace(/[^a-z0-9]/gi, "-")
  .toLowerCase()
  .slice(0, 40);
```
N'utilisait que `basename`, pas le dossier parent.

**Fix appliqué** :
```ts
const parentDir = path.basename(path.dirname(file));
const baseName = path.basename(file).replace(/\.[^.]+$/, "");
const slug = `${parentDir}-${baseName}`.replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 40);
```

**Si cette régression réapparaît** : vérifier que le slug CONFIG_CHANGE inclut `parentDir` — sans quoi des fichiers homonymes dans des dossiers différents produisent des IDs identiques et les signaux sont silencieusement perdus.
