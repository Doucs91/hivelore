---
id: 2026-05-29-skill-capture-failed-approach-immediately
scope: team
type: skill
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - mem_tried
  - workflow
  - agent-behavior
created_at: '2026-05-29T19:47:24.597Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: skill/capture-failed-approach
revision_count: 0
requires_human_approval: false
---
# Skill: Capturer une approche échouée immédiatement

**Règle absolue** : appeler `mem_tried` AVANT de corriger. Pas après. Pas en fin de session. Avant.

## Quand déclencher (liste exhaustive)

| Situation | Exemple concret |
|-----------|----------------|
| Option CLI inexistante | `haive init --yes` → "unknown option" |
| Import/API qui n'existe pas | `import { X } from "pkg"` → ERR_MODULE_NOT_FOUND |
| Test qui échoue à cause d'une mauvaise hypothèse | Asserter `level === "info"` alors que la logique produit "review" |
| Approche entièrement refaite (> 15 min perdues) | Réécrire une fonction après avoir mal compris l'interface |
| Regex/pattern qui semble correct mais ne matche pas | `/\b(foo)\b/.test(command)` ne matche pas ce qu'on croit |
| Comportement surprenant d'une lib qu'on ne documente PAS | Ce sera un gotcha, pas un attempt |

## Comment appeler

```
mem_tried(
  what: "description courte de ce qu'on a essayé",
  why_failed: "l'erreur exacte ou la raison précise",
  instead: "ce qu'il faut faire à la place",
  paths: ["fichier concerné si pertinent"],
  scope: "team"  // si applicable à toute l'équipe, sinon "personal"
)
```

## Anti-patterns à éviter

- ❌ Corriger silencieusement sans documenter → la prochaine session refait la même erreur
- ❌ Attendre la fin de session → le contexte est perdu, le body sera vague
- ❌ Documenter uniquement dans un commentaire de code → invisible aux autres agents
- ❌ "C'était une erreur évidente, pas besoin de documenter" → ce que toi tu trouves évident maintenant sera oublié demain
