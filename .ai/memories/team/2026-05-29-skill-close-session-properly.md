---
id: 2026-05-29-skill-close-session-properly
scope: team
type: skill
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - mem_session_end
  - workflow
  - agent-behavior
created_at: '2026-05-29T19:47:47.912Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: skill/close-session
revision_count: 0
requires_human_approval: false
---
# Skill: Fermer une session proprement

**Règle** : avant de conclure une tâche significative (> 30 min ou > 5 fichiers modifiés), faire le checklist ci-dessous.

## Checklist avant de conclure

1. **Approches échouées documentées ?**  
   → Relire mentalement la session. Y a-t-il eu des erreurs/refactos/revenirs-en-arrière ?  
   → Si oui et pas encore documentées : `mem_tried` maintenant.

2. **Décisions architecturales capturées ?**  
   → Y a-t-il eu un choix non-évident (lib, pattern, structure) ?  
   → Si oui et pas encore documenté : `mem_save type=decision` maintenant.

3. **Gotchas découverts ?**  
   → Comportements surprenants dans le code ou les dépendances ?  
   → Si oui et pas encore documentés : `mem_save type=gotcha` maintenant.

4. **Appeler `mem_session_end` avec les vrais champs remplis :**

```
mem_session_end(
  goal: "Ce que tu essayais d'accomplir (1-2 phrases)",
  accomplished: "- bullet 1\n- bullet 2\n...",
  discoveries: "Ce qui t'a surpris, les pièges rencontrés, les angles morts",  ← NE PAS LAISSER VIDE
  files_touched: ["les fichiers clés modifiés"],
  next_steps: "Ce qui reste à faire",
  scope: "team"  // si c'est une session de travail partagé
)
```

## Le champ `discoveries` est le plus important

C'est ce que la prochaine session ne pourra pas deviner depuis git diff. Exemples :
- "Le pre-commit gate bloque sur les commits config-only à cause du matching littéral"
- "anchor_paths dans MemMatch était vide — le fix était d'exposer fm.anchor.paths"
- "L'assertion `level === 'info'` était fausse car anchorPathTokens inclut les segments de chemin"

## Anti-pattern

❌ `mem_session_end(goal: "...", accomplished: "...", discoveries: "")` — session-end sans discoveries n'a aucune valeur au-delà de ce que git log montre déjà.
