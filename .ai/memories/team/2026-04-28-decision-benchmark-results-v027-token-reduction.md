---
id: 2026-04-28-decision-benchmark-results-v027-token-reduction
scope: team
type: decision
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - benchmark
  - tokens
  - roi
  - measurement
created_at: '2026-04-28T15:04:31.053Z'
expires_when: null
verified_at: null
stale_reason: null
---
# Benchmark v0.2.7 — Résultats mesurés de réduction de tokens

Test réalisé le 2026-04-28 sur sandaga-monorepo (Spring Boot + React, ~1.3GB).
Méthodologie : 4 agents en parallèle, 2 tâches identiques avec/sans hAIve.

## Résultats agrégés (2 tâches)

| Métrique | Sans hAIve | Avec hAIve | Réduction |
|---|---|---|---|
| Tokens totaux | 73 487 | 49 540 | **−32,6 %** |
| Appels d'outils | 57 | 17 | **−70,2 %** |
| Durée totale | 2 min 45 s | 1 min 44 s | **−36,4 %** |
| Fichiers lus | 23 | 6 | **−73,9 %** |

## Par type de tâche

**Tâche complexe (architecture paiement)** :
- Sans hAIve : 59 278 tokens, 47 appels, 20 fichiers lus
- Avec hAIve : 36 799 tokens, 15 appels, 6 fichiers lus
- Gain : **−38 % tokens, −68 % appels**

**Tâche debugging ciblée (Flyway checksum)** :
- Sans hAIve : 14 209 tokens, 10 appels, 3 fichiers lus
- Avec hAIve : 12 741 tokens, 2 appels, 0 fichier lu
- Gain : **−10 % tokens, −80 % appels, −32 % temps**

## Observations clés

1. **Plus la tâche est architecturale, plus le gain est élevé** — les tâches exploratoires bénéficient davantage que les tâches de debugging ciblé
2. **Le bridge file (CLAUDE.md) apporte de la valeur passive** — même sans appeler haive explicitement, l'agent sans hAIve a tiré parti du CLAUDE.md généré par haive init
3. **hAIve vaut ce qu'on lui donne** — l'agent sans hAIve a découvert un gotcha (mobile_payments sans migration) absent des mémoires ; post-benchmark, cette mémoire a été ajoutée
4. **−70 % d'appels d'outils = réduction directe de latence** — chaque appel évité est ~1-2s de latence en moins

## Conclusion

Le gain principal n'est pas uniquement les tokens économisés mais la **réduction du tâtonnement** : l'agent avec hAIve arrive directement au bon fichier, avec le bon nom de classe, au premier essai.
