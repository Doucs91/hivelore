---
id: 2026-06-02-decision-harness-engineering-positioning-roadmap
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/index.ts
    - packages/mcp/src/server.ts
    - packages/cli/src/index.ts
  symbols: []
tags:
  - strategy
  - roadmap
  - harness-engineering
  - positioning
created_at: '2026-06-02T03:55:39.544Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
## Positionnement de hAIve dans le Harness Engineering (analyse 2026-06-01)

Synthèse de 7 sources (Fowler, Anthropic long-running agents, Faros 5-layer, awesome-harness-engineering, NxCode, RedHat, Augment).

### Cadre du domaine
- **Fowler** : harness = tout sauf le modèle. Deux contrôles : **guides (feedforward, avant l'action)** + **sensors (feedback, après l'action)**. Computationnel (déterministe: lint/test/typecheck) vs inférentiel (IA). Steering loop : "chaque erreur → une solution durable pour qu'elle ne se reproduise jamais". 3 régulations : maintenabilité (mature), fitness archi (moyen), **comportement (non résolu)**.
- **Faros 5 couches** : 1.tool orchestration 2.verification loops 3.**context & memory** 4.guardrails 5.observability.
- **Anthropic** : mémoire repo-native (progress files, git comme état), travail incrémental, vérif au démarrage.

### Où est hAIve
Couche 3 (Context & Memory) + steering policy. **Implémentation la plus propre de la boucle feedback-sur-connaissance** (mem_tried capture, get_briefing réinjecte). MAIS : 1 couche sur 5, et **uniquement feedback, pas feedforward**.

### Forces
Mémoire repo-native git-versionnée/PR-reviewable/team-shared ; taxonomie typée ; **mémoire négative (mem_tried)** ; couche enforcement ; MCP-natif ; coordination multi-agent ; embeddings locaux ; mesure d'impact ; léger zéro-infra.

### Faiblesses
1 couche/5 ; tout feedback zéro feedforward ; behaviour harness absent ; enforcement majoritairement soft (prose CLAUDE.md) ; risque pourrissement/bloat mémoire ; charge de discipline manuelle ; pas positionné comme standard portable.

### Roadmap (priorisée) — "rendre hAIve irrésistible"
1. **Memory→Guardrail compiler** (KILLER) : générer depuis gotcha/convention/attempt un check exécutable (lint custom, fitness fn, pre-commit hook). Pont mémoire→feedforward. Personne ne le fait.
2. **Auto-capture depuis CI & revues PR** : un échec CI / commentaire PR génère une mémoire automatiquement.
3. **Harness templates par topologie** (Next.js+NestJS, Python…) : seed memories+conventions+checks.
4. **Behaviour harness** : relier spec.json/eval aux mem_tried → evals de régression.
5. **Cycle de vie auto mémoire** : décroissance, confiance, contradictions, dédup/merge, promotion personal→team.
6. **Dashboard observabilité mémoire** : étendre memory-impact, drift detection.
7. **Guardrails durs** : phase-gating / intent-level au-delà de la prose.
8. **`.ai/` comme standard ouvert** : adapters cross-harness (Cursor, Copilot…).
9. **Chargement progressif du contexte** : fragments à la demande (anti-bloat).

### Thèse
hAIve = meilleure mémoire repo-native + steering policy, mais 1 couche/5 et feedback-only. Pour devenir irrésistible : **convertir les mémoires en guides déterministes (feedforward)** + **auto-capture CI/PR**. Alors hAIve devient le control plane qui ferme la boucle de Fowler à la place de l'humain.
