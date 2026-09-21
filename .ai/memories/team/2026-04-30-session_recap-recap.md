---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/cli/src/commands/agent.ts
    - packages/cli/src/commands/codex-mcp.ts
    - packages/cli/src/commands/init-mcp-setup.ts
    - packages/cli/src/commands/doctor.ts
    - packages/cli/src/commands/mcp.ts
    - packages/cli/src/utils/mcp-check.ts
    - packages/mcp/src/context.ts
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-09-21T17:11:38.605Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 47
requires_human_approval: false
validated_by: null
---
## Goal
Réparer l’accès MCP des agents IA après installation globale de Hivelore.

## Accomplished
Migration Codex via sa CLI native, suppression du nom de commande haive et du projet global figé ; migration JSONC sans écraser les autres réglages ; configuration Gemini et Roo détectés ; prise en compte du projet explicite et des variables de contexte ; diagnostic de configuration distinct du test serveur agent check et de l’accès réel dans une session. Configurations locales et globales de cette machine réparées. Version 0.63.1 préparée.

## Discoveries & surprises
Le helper Codex séparé créait encore une commande haive obsolète. L’entrée CLI MCP ignorait les variables de projet. Le bac à sable bloque certains sous-processus Node, mais le même dialogue MCP réussit hors restriction.

## Files touched
- `packages/cli/src/commands/agent.ts`
- `packages/cli/src/commands/codex-mcp.ts`
- `packages/cli/src/commands/init-mcp-setup.ts`
- `packages/cli/src/commands/doctor.ts`
- `packages/cli/src/commands/mcp.ts`
- `packages/cli/src/utils/mcp-check.ts`
- `packages/mcp/src/context.ts`

## Next steps
Redémarrer chaque client puis appeler get_briefing pour confirmer l’accès dans sa session. Publication npm réservée au mainteneur. Les rapports clients originaux restent inchangés.

## Session history

### 2026-09-20
Améliorer Hivelore à partir des retours clients du 18 septembre
**Next:** Mesurer interruptions, latence et utilité dans les sessions du projet client. Publication npm réservée au mainteneur. Les rapports originaux restent inchangés et non suivis.

### 2026-09-20
Rendre Hivelore utile aux agents à partir des retours clients du 18 septembre
**Next:** Terminer la vérification finale, commit/tag v0.63.0 et CI distante. Publication npm réservée au mainteneur. Mesurer ensuite les améliorations dans les sessions du projet client.

### 2026-08-21
Answer empirically why a field report scored the briefing 30/100 while `hivelore eval` reported 98% recall, then fix whatever the measurement found.
**Next:** - Add eval cases where SEVERAL memories legitimately match the same files — the eval currently cannot measure what this release improved. - Re-anchor the 6 memories `doctor` now names; each needs the precise path its lesson is really about. - Still open from the field report: §4.3 active decay, §4.5
