---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/cli/src/index.ts
    - packages/cli/src/commands/memory-query.ts
    - packages/cli/src/commands/memory-show.ts
    - packages/cli/src/commands/memory-add.ts
    - packages/cli/src/commands/memory-rm.ts
    - packages/cli/src/commands/doctor.ts
    - packages/cli/test/cli.test.ts
    - docs/HARNESS-COHERENCE-MAP-2026-06.md
    - CHANGELOG.md
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-02T16:23:05.034Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 20
requires_human_approval: false
---
## Goal
Analyser le harness engineering vs hAIve, produire la carte de cohérence de surface CLI/MCP (P0), puis implémenter la Phase A (aligner les verbes memory CLI sur les noms d'outils MCP).

## Accomplished
- Recherche web indépendante (Fowler, Thoughtworks, Augment) + analyse croisée avec un autre agent.
- docs/HARNESS-COHERENCE-MAP-2026-06.md : cartographie exhaustive CLI (11 core + 18 advanced + 29 memory) et MCP (4 profils), plan en 5 phases non-breaking.
- Phase A livrée (v0.13.2) : haive memory add→save, query→search, show→get, rm→delete (canoniques), anciens verbes en alias. CORE_MEMORY_COMMANDS + hints (doctor/welcome/sync/stats/pending) mis à jour. 3 tests de non-régression. 55 tests verts, 4 workflows CI verts, enforce finish 100%.

## Discoveries & surprises
- La prémisse "hAIve = 60 commandes plates, charge cognitive" est FAUSSE : le golden path existe déjà (index.ts CORE_ROOT/MEMORY/SESSION_COMMANDS derrière --advanced) ET le MCP a 4 profils (enforcement défaut = 11 outils). Vérifier le code avant de croire un diagnostic de surface.
- Les "doublons" allégués n'en sont pas : bench.ts (self-test latence) ≠ benchmark.ts (mesure haive-vs-plain) ; observe.ts (hook PostToolUse) ≠ runtime-journal.ts (journal NDJSON) ; memory-* (CLI) vs mem-* (MCP) = parité voulue à 2 façades.
- memory digest (rapport Markdown de revue) ≠ mcp mem_distill (clustering d'observations) — NE PAS aliaser, opérations différentes.
- Le vrai défaut de cohérence = dérive de vocabulaire entre les 2 façades (mem_search vs memory query, mem_get vs memory show).
- Le gate decision-coverage au pre-commit exige un get_briefing MCP (pas le briefing CLI) couvrant TOUS les fichiers changés, avec max_memories élevé (cf. memory decision-coverage-gate-needs-high-max-memories). Le briefing CLI ne pose pas le même marqueur que le hook lit.

## Files touched
- `packages/cli/src/index.ts`
- `packages/cli/src/commands/memory-query.ts`
- `packages/cli/src/commands/memory-show.ts`
- `packages/cli/src/commands/memory-add.ts`
- `packages/cli/src/commands/memory-rm.ts`
- `packages/cli/src/commands/doctor.ts`
- `packages/cli/test/cli.test.ts`
- `docs/HARNESS-COHERENCE-MAP-2026-06.md`
- `CHANGELOG.md`

## Next steps
Phases B-E de la carte de cohérence (toutes non-breaking) : B documenter le golden path (README+help), C désambiguïser bench/benchmark, D folder install-hooks/precommit sous enforce, E grouper l'avancé en familles index/report/eval/runtime.
