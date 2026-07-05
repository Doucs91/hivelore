---
id: 2026-07-05-attempt-ajouter-un-nouveau-sensor-discriminant
scope: team
type: attempt
status: validated
anchor:
  paths:
    - packages/core/src/sensors.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags: []
created_at: '2026-07-05T16:15:46.901Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Ajouter un nouveau sensor discriminant avec `absent` sous le gate strict de weakening

**Why it failed / do NOT use:** `detectSensorWeakening` a classé l'ajout d'un tout nouveau sensor comme `suppression-broadened`, donc le strict gate bloque une protection nouvelle au lieu de ne surveiller que les sensors existants.

**Instead, use:** Corriger le détecteur pour ignorer les fichiers/sensors absents de l'ancien côté du diff, ajouter un test de non-régression, puis relancer le gate.
