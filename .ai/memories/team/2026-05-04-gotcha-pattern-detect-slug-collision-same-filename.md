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
created_at: '2026-05-04T01:05:45.010Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# pattern_detect produit des slugs collidants pour des fichiers homonymes dans des dossiers différents

**Reproduit en v0.9.0** : 3 modifications de `vitest.config.ts` (cli/, core/, embeddings/) → 3 matches `config_change` avec le **même slug** `config-change-vitest-config`. Conséquence : `id` identique (date+slug+type), seul le 1er fichier mémoire est créé, les 2 autres signaux sont silencieusement perdus.

**Code en cause** : `packages/mcp/src/tools/pattern-detect.ts` ligne ~122 :
```ts
const slug = path.basename(file)
  .replace(/\.[^.]+$/, "")
  .replace(/[^a-z0-9]/gi, "-")
  .toLowerCase()
  .slice(0, 40);
```
N'utilise que `basename`, pas le dossier parent.

**Fix proposé** : inclure un hash court ou la première partie du dossier dans le slug :
```ts
const dir = path.dirname(file).split("/").filter(Boolean).slice(-2).join("-");
const slug = `${dir}-${path.basename(file).replace(...)}`.slice(0, 40);
```

**Workaround** : la fonction skip silencieusement via `if (existsSync(file)) continue;` — pas d'erreur visible mais signal perdu.
