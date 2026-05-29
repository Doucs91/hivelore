---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - CLAUDE.md
    - packages/cli/src/commands/observe.ts
    - packages/cli/src/commands/session-end.ts
    - .ai/memories/team/2026-05-29-skill-capture-failed-approach-immediately.md
    - .ai/memories/team/2026-05-29-skill-save-decision-or-gotcha-mid-task.md
    - .ai/memories/team/2026-05-29-skill-close-session-properly.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-05-29T19:51:32.782Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 5
requires_human_approval: false
---
## Goal
Analyser les changements de l'autre agent pour rendre hAIve naturel, puis implémenter des améliorations complémentaires ciblant les vrais angles morts.

## Accomplished
- Analysé commit d32ddb0 (autre agent): haive observe PostToolUse, session-end auto depuis git, pre-tool-use vérifie mémoires ancrées aux fichiers édités, briefing déclenche autopilot repairs
- Identifié 3 angles morts résiduels: mem_tried non déclenché après échec, mem_save pour décisions jamais fait spontanément, session-end sans discoveries
- Créé 3 skill memories (surfacées must_read dans get_briefing): capture-failed-approach-immediately, save-decision-or-gotcha-mid-task, close-session-properly
- Amélioré CLAUDE.md: ajouté table "Behavioral triggers" avec situation→action→outil, règle sur discoveries obligatoires
- Amélioré haive observe: détecte failures depuis tool_response (exit code ≠ 0, ERR_MODULE_NOT_FOUND, TS errors, command not found), ajoute failure_hint: true
- Amélioré session-end --auto: collecte les observations avec failure_hint et les injecte dans discoveries comme candidats mem_tried
- 218 tests, 0 échec (was 210)

## Discoveries & surprises
- Le marker de briefing est écrit par `haive enforce session-start` (CLI), PAS par `get_briefing` (MCP). Si le SessionStart hook écrit le marker mais avec un session_id qui ne correspond pas au PreToolUse, tout Bash est bloqué. Fix: appeler `haive enforce session-start` manuellement quand bloqué.
- Les skill memories sont surfacées `must_read` dans get_briefing seulement quand elles matchent la tâche ou les fichiers. Pour les skills comportementaux généraux (pas ancrés à des fichiers), le match vient du semantic score sur la description de la tâche.
- `haive observe` reçoit `tool_response` dans le payload PostToolUse — ce champ était ignoré avant. Il contient l'exit code pour Bash et les erreurs pour Edit/Write.

## Files touched
- `CLAUDE.md`
- `packages/cli/src/commands/observe.ts`
- `packages/cli/src/commands/session-end.ts`
- `.ai/memories/team/2026-05-29-skill-capture-failed-approach-immediately.md`
- `.ai/memories/team/2026-05-29-skill-save-decision-or-gotcha-mid-task.md`
- `.ai/memories/team/2026-05-29-skill-close-session-properly.md`

## Next steps
Les 3 skills ne s'affichent que si le score sémantique est suffisant. Pour maximiser leur visibilité: (1) tester que les skills apparaissent bien dans get_briefing pour des tâches de codage typiques, (2) éventuellement ajouter des tags ou anchor symbols pour améliorer le recall.
