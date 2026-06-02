---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/index.ts
    - packages/cli/src/commands/bench.ts
    - packages/cli/src/commands/benchmark.ts
    - packages/cli/src/commands/memory-query.ts
    - packages/cli/src/commands/memory-show.ts
    - packages/cli/test/cli.test.ts
    - docs/HARNESS-COHERENCE-MAP-2026-06.md
    - README.md
    - CHANGELOG.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-02T17:30:18.524Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 21
requires_human_approval: false
---
## Goal
Rendre l'existant de hAIve cohérent (carte de cohérence CLI/MCP) : exécuter Phase A (verbes), B (golden path), le fix racine skip-ci-tip, puis C/D/E — tout non-breaking, chaque release atomique et CI-vérifiée.

## Accomplished
- A (v0.13.2): verbes memory alignés sur MCP (save/search/get/delete canoniques, anciens en alias).
- B (v0.13.3): golden path rendu visible (README + after-text du --help).
- Fix racine (v0.13.4): enforce check --stage pre-commit stage maintenant .ai/project-context.md re-synchronisé → commit de release atomique, plus jamais de tip 'chore sync skip-ci'. Prouvé: HEAD reste le commit de release, git pull 'déjà à jour'.
- C/D/E (v0.13.5): bench→selftest (alias), install-hooks/precommit étiquetés équivalents enforce, familles dans --advanced help. Regroupement d'arbre profond différé (collisions report/index = breaking).
- 58 tests CLI verts ; 4 workflows CI verts par release ; enforce finish 100%.

## Discoveries & surprises
- GOTCHA MAJEUR (capturé en mémoire): GitHub scanne TOUT le message de commit (sujet ET corps) pour [skip ci]. Mon commit du fix v0.13.4 citait la chaîne dans son corps → CI sautée pour tout le push (0 run). Ne jamais mettre la chaîne littérale skip-ci dans un message de commit qui contient du code. Fallback: ci.yml a workflow_dispatch.
- La prémisse initiale 'hAIve = 60 commandes plates' était FAUSSE: golden path (--advanced) + profils MCP existaient déjà. Et bench/benchmark, observe/runtime ne sont PAS des doublons.
- Cause racine skip-ci-tip: applyLightweightRepairs sync project-context APRÈS le staging → drift → workflow le commit en skip-ci. Fix = stager dans le stage pre-commit.
- Le hook git pre-commit utilise le haive GLOBAL, pas le dist du repo: pour qu'un fix d'enforcement s'applique à mon propre commit, il faut hot-swap dist→global d'abord.
- Le gate decision-coverage exige un get_briefing MCP (pas CLI) couvrant TOUS les fichiers changés avec max_memories élevé.
- E non-breaking est limité par collisions de noms (report sous benchmark, index feuille): regrouper agressivement serait breaking.

## Files touched
- `packages/cli/src/commands/enforce.ts`
- `packages/cli/src/index.ts`
- `packages/cli/src/commands/bench.ts`
- `packages/cli/src/commands/benchmark.ts`
- `packages/cli/src/commands/memory-query.ts`
- `packages/cli/src/commands/memory-show.ts`
- `packages/cli/test/cli.test.ts`
- `docs/HARNESS-COHERENCE-MAP-2026-06.md`
- `README.md`
- `CHANGELOG.md`

## Next steps
Optionnel: regroupement d'arbre profond de E (report/index families) en mode breaking assumé avec dépréciation multi-étapes, si l'équipe l'accepte. Sinon les phases A–E de la carte de cohérence sont complètes.
