---
id: 2026-05-31-decision-git-sync-protocol-multi-agent
scope: team
type: decision
status: validated
anchor:
  paths:
    - .ai/project-context.md
  symbols: []
tags:
  - git
  - workflow
  - coordination
  - versioning
  - multi-agent
created_at: '2026-05-31T22:25:44.873Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Git sync protocol for multi-agent work

## Guidance
Plusieurs agents ET l'humain (Sady) travaillent en parallèle sur ce repo avec des pull/push manuels. Sans protocole commun, on obtient des conflits (ex: marqueurs de conflit laissés dans .ai/project-context.md) et des versions désynchronisées.

PROTOCOLE OBLIGATOIRE POUR TOUT AGENT:

AVANT de commencer une tâche (entrée):
1. git pull (récupérer la dernière version depuis GitHub).
2. Résoudre les conflits éventuels AVANT de toucher au code.
3. Vérifier qu'aucun marqueur de conflit ne subsiste (<<<<<<<, =======, >>>>>>>), surtout dans .ai/.

APRÈS modification du code (sortie):
1. git commit des changements.
2. BUMP de version UNIQUEMENT si le code livrable change (packages publiables: @hiveai/core, cli, mcp, embeddings). Les commits qui ne touchent que docs / .ai/ / config / CI → commit + push SANS bump ni tag.
3. Si bump: patch par défaut (0.10.1 → 0.10.2). minor/major seulement si justifié (feature / breaking). Versions en lockstep sur les 4 packages publiables.
4. Si bump: créer le tag git vX.Y.Z correspondant.
5. git push du code ET des tags vers GitHub (git push && git push --tags).

FRONTIÈRE: l'agent NE publie JAMAIS sur npm. La publication npm est faite par l'humain (Sady).

## Why
Because multiple agents and the human push/pull the same branch concurrently, skipping `git pull` before a task causes merge conflicts (conflict markers were left in `.ai/project-context.md`) and version drift between local work and GitHub. The rule exists to force a clean, current base before editing and a consistent commit/tag/push afterwards.

What to do instead of working blind: always `git pull` and clear conflict markers first; after shippable code changes, bump (patch by default, lockstep across the 4 publishable packages), tag `vX.Y.Z`, and `git push --tags`; never run `npm publish` — leave npm publication to the human (Sady).
