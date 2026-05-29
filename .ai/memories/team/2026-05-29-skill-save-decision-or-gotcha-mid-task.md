---
id: 2026-05-29-skill-save-decision-or-gotcha-mid-task
scope: team
type: skill
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - mem_save
  - workflow
  - agent-behavior
created_at: '2026-05-29T19:47:35.435Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: skill/save-decision-or-gotcha
revision_count: 0
requires_human_approval: false
---
# Skill: Sauvegarder une décision ou un gotcha en cours de tâche

**Règle** : si tu fais un choix non-évident ou découvres un comportement surprenant, `mem_save` DANS LA MÊME RÉPONSE — pas à la fin de session.

## Quand déclencher

| Situation | Type de mémoire |
|-----------|----------------|
| Tu choisis A plutôt que B pour une raison non-évidente | `decision` |
| Tu découvres un comportement inattendu d'une lib/outil | `gotcha` |
| Tu inventes un pattern réutilisé > 1 fois dans la session | `convention` |
| Tu comprends POURQUOI une partie du code est faite ainsi | `decision` ou `architecture` |
| Tu trouves une contrainte cachée (perf, sécurité, compatibilité) | `gotcha` |

## Seuil minimal pour sauvegarder

La question test : *"Si je reviens dans 3 semaines, est-ce que je referais la même erreur sans cette mémoire ?"*  
Si oui → sauvegarder maintenant.

## Template décision

```
mem_save(
  type: "decision",
  slug: "pourquoi-X-plutot-que-Y",
  body: "## Décision\nUtiliser X.\n\n## Pourquoi\nY cause [problème précis].\n\n## Alternatives rejetées\n- Y: [raison]\n",
  paths: ["fichier où la décision s'applique"],
  scope: "team"
)
```

## Template gotcha

```
mem_save(
  type: "gotcha",
  slug: "comportement-surprenant-de-X",
  body: "## Piège\nX se comporte de façon Y quand Z.\n\n## Impact\n...\n\n## Fix\n...",
  paths: ["fichier concerné"],
  scope: "team"
)
```

## Ce qui NE mérite PAS une mémoire

- Comportement évident documenté dans la doc officielle
- Choix stylistique sans impact sur la logique
- Correction d'une typo ou d'un bug trivial
