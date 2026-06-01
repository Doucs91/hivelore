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
tags:
  - auto-promote
  - config
  - v0.9.0
  - bug
created_at: '2026-05-04T01:06:01.101Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
sensor:
  kind: regex
  pattern: "minReads\\s*:\\s*DEFAULT_AUTO_PROMOTE_RULE\\.minReads"
  message: "Do not assign `minReads: DEFAULT_AUTO_PROMOTE_RULE.minReads` directly — always load config first: `cfg.autoPromoteMinReads ?? DEFAULT_AUTO_PROMOTE_RULE.minReads`. The hardcoded default ignores the user's `autoPromoteMinReads` config."
  severity: warn
  autogen: false
  last_fired: null
  paths:
    - packages/mcp/src/tools/get-briefing.ts
    - packages/core/src/config.ts
---
# Auto-promote inline ignore `autoPromoteMinReads` du config — utilise le default 5 en dur

**Reproduit en v0.9.0** : la config `.ai/haive.config.json` (autopilot par défaut) contient `"autoPromoteMinReads": 1`. Mais l'auto-promote inline dans `get-briefing.ts` utilise `DEFAULT_AUTO_PROMOTE_RULE.minReads` (= 5) en dur sans charger la config :

```ts
// packages/mcp/src/tools/get-briefing.ts:358-361
const rule = {
  minReads: DEFAULT_AUTO_PROMOTE_RULE.minReads,  // ← hardcoded 5
  maxRejections: DEFAULT_AUTO_PROMOTE_RULE.maxRejections,
};
```

**Impact** : les utilisateurs autopilot s'attendent à une promotion rapide (minReads=1) mais ne l'obtiennent pas. Le verdict final "passive validation par usage" qui est promis dans la 0.9.0 ne marche qu'au seuil par défaut, pas au seuil configurable.

**Fix** : `loadConfig(ctx.paths)` au début et utiliser `config.autoPromoteMinReads ?? DEFAULT_AUTO_PROMOTE_RULE.minReads`.

**Vérifié e2e** : 5 briefings consécutifs sur une mémoire `proposed` → status passe à `validated` à l'itération 5 (et non 1 comme attendu par config autopilot). Le mécanisme MARCHE, mais ignore la config.
