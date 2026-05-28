---
id: 2026-05-04-decision-v091-bugfixes-overview
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/config.ts
  symbols:
    - loadConfig
tags: []
created_at: '2026-05-04T02:44:21.853Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# v0.9.1 — Corrections des 4 bugs identifiés lors de l'audit v0.9.0

## Bugs corrigés

### Bug #1 — haive-mcp désynchronisé (CRITIQUE)
Fix : flag --version ajouté sur haive-mcp ; haive doctor détecte le mismatch CLI/MCP et suggère npm i -g @hiveai/cli@X @hiveai/mcp@X.

### Bug #2 — pattern_detect slug collision
Fix : slug CONFIG_CHANGE inclut parentDir-baseName. Fin des collisions pour fichiers homonymes dans dossiers différents.

### Bug #3 — mem_save ignore scope explicite
Fix : scope Zod rendu .optional() ; resolvedScope = input.scope ?? config.defaultScope ?? 'personal' calculé tôt ; utilisé pour dedup, topic-upsert et création.

### Bug #4 — auto-promote ignore autoPromoteMinReads
Fix : loadConfig() juste avant le bloc inline auto-promote ; rule.minReads = cfg.autoPromoteMinReads ?? DEFAULT.

## Tests
+4 régression tests (140 total). Build propre.
