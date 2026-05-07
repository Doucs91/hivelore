# Résultats — benchmark manuel

Modèle (Cursor) : _à compléter par l’exécutant_  
Date : 2026-05-05  
Branche : _local_

## T1 — Validation `CreateOrderInputSchema`

| Bras | Projet ouvert | Briefing haive / mémoires | Temps jusqu’au vert (wall-clock) | Erreurs terminal (nombre) | Itérations test→fix | Tokens (in/out) | Notes |
|------|---------------|---------------------------|----------------------------------|----------------------------|---------------------|-----------------|-------|
| A — haive | `fixtures/order-haive` | `get_briefing` MCP : 0 mémoire retournée (racine MCP ≠ fixture) ; mémoire lue sur disque `.ai/memories/team/…` | ~session agent (non chronométré strictement) ; `pnpm test` post-fix **1,35 s** | 0 après correction schéma ; phase setup : échec `zod` résolu par `pnpm install --ignore-workspace` | 1 (schéma → tests verts) | N/A | Correctif appliqué : `z.number().int().positive()` + `z.string().trim().min(1)` aligné mémoire |
| B — sans haive | `fixtures/order-plain` | Aucun | idem ; `pnpm test` ~0,4 s | 0 après correction | 1 | N/A | Correctif possible sans mémoire : `z.number().int().min(1)` + `z.string().min(1)` — pas de `.trim()` requis par les tests |

### Pilotage infrastructure (hors protocole idéal)

- Les fixtures sont **sous un monorepo pnpm** : un `pnpm install` « normal » depuis le sous-dossier remonte au workspace et Vitest ne voit pas `zod`. **Recommandé dans le RUNBOOK** : `npm install` / `npm test` dans le sous-dossier, ou `pnpm install --ignore-workspace`.

### Suite

- Reprendre T1 avec **deux chats distincts**, même modèle, temps depuis l’envoi du prompt jusqu’au vert.
- Répéter N≥5 par bras pour une moyenne / médiane.
