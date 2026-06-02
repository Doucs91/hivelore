# Carte de cohérence de surface — CLI + MCP (P0)

> **But.** Cartographier exhaustivement la surface de commandes de hAIve (CLI + MCP), corriger
> le diagnostic « 60 commandes plates » (faux), isoler les **vrais** défauts de cohérence, et
> proposer un plan de consolidation **100 % non-breaking** (alias + dépréciation douce).
> Cadre théorique : Fowler désigne la *harness coherence* comme une lacune ouverte du domaine.
> hAIve doit être cohérent **avec lui-même** avant tout ajout.
>
> Source de vérité : `packages/cli/src/index.ts`, `packages/mcp/src/server.ts` (v0.13.1).

---

## 0. TL;DR — la prémisse était fausse, le vrai défaut est ailleurs

Deux idées reçues à corriger d'emblée :

1. **« hAIve = 60 commandes plates, charge cognitive énorme » → FAUX.** Les deux surfaces
   implémentent **déjà** un golden path par disclosure progressive :
   - **CLI** : `index.ts:143-168` définit `CORE_ROOT_COMMANDS` (11), `CORE_MEMORY_COMMANDS` (8),
     `CORE_SESSION_COMMANDS` (1). Tout le reste est masqué derrière `--advanced` /
     `HAIVE_SHOW_ADVANCED=1`. Le help par défaut montre ~11 commandes.
   - **MCP** : `server.ts:300-352` définit 4 profils — `enforcement` (11 outils, **défaut**) →
     `maintenance` (~30) → `experimental` (~37) → `full`. Un agent en mode défaut ne voit que 11 outils.

2. **« bench/benchmark, observe/runtime, memory-*/mem-* sont des doublons à fusionner » → FAUX.**
   Ce sont des outils **distincts** (cf. §4) ou la **parité voulue à deux façades**. Il n'y a quasiment
   rien à *fusionner*.

**Le vrai défaut de cohérence** est la **dérive de vocabulaire entre les deux façades** (MCP `mem_search`
↔ CLI `memory query`, MCP `mem_get` ↔ CLI `memory show`…), plus une poignée de noms ambigus et de
recouvrements `enforce`/`precommit`/`install-hooks`. C'est étroit, précis, et corrigeable sans casse.

---

## 1. Surface réelle — inventaire exhaustif

### 1.1 CLI — arbre top-level

**Cœur (visible par défaut, 11) :**

| Commande | Sous-commandes | Rôle |
|----------|----------------|------|
| `init` | — | Crée la couche `.ai/` + bridges |
| `doctor` | — | Diagnostic d'installation |
| `agent` | `detect`, `status`, `setup` | Détecte/configure le mode agent |
| `briefing` | — | Feedforward briefing (façade CLI de `get_briefing`) |
| `enforce` | `install`, `status`, `check`, `cleanup`, `ci`, `finish`, `session-start`, `pre-tool-use` | Gates (hooks/CI/MCP) |
| `run` | — | Wrappe une commande agent dans une session enforce |
| `sensors` | `list`, `check`, `promote`, `export` | Sensors exécutables (feedback) |
| `sync` | — | Re-scan staleness + inject bridges |
| `mcp` | — | Lance/déclare le serveur MCP |
| `memory` | 29 sous-cmd (voir 1.2) | Gestion du corpus |
| `session` | `end` | Recap de fin de session |

**Avancé (masqué derrière `--advanced`, 18) :**

`welcome` · `resolve-project` · `runtime {append, tail}` · `snapshot` · `hub {init, push, pull, status}`
· `stats` · `bench` · `benchmark` · `eval` · `playback` · `precommit` · `tui` · `embeddings` · `index`
· `observe` · `install-hooks` · `dashboard` · `ingest`

### 1.2 CLI — sous-commandes `memory` (29)

**Cœur (8) :** `add`, `list`, `query`, `show`, `verify`, `lint`, `tried`, `rm`
**Avancé (21) :** `promote`, `stats`, `impact`, `feedback`, `reject`, `auto-promote`, `for-files`,
`edit`, `pending`, `approve`, `update`, `hot`, `seed`, `import`, `import-changelog`, `digest`,
`suggest`, `suggest-topic`, `timeline`, `conflict-candidates`, `archive`

### 1.3 MCP — outils par profil

- **`enforcement` (11, défaut) :** `get_briefing`, `mem_save`, `mem_tried`, `mem_search`, `mem_get`,
  `mem_verify`, `mem_relevant_to`, `code_map`, `code_search`, `pre_commit_check`, `mem_session_end`
- **`maintenance` (+19) :** `mem_suggest_topic`, `mem_for_files`, `mem_list`, `get_project_context`,
  `bootstrap_project_save`, `mem_resolve_project`, `mem_update`, `mem_approve`, `mem_reject`,
  `mem_pending`, `mem_delete`, `mem_diff`, `get_recap`, `anti_patterns_check`, `mem_distill`,
  `mem_timeline`, `mem_conflict_candidates`, `mem_feedback`, `ingest_findings`
- **`experimental` (+7) :** `mem_observe`, `why_this_file`, `why_this_decision`, `mem_conflicts_with`,
  `pattern_detect`, `runtime_journal_append`, `runtime_journal_tail`
- **Prompts :** `bootstrap_project`, `post_task`, `import_docs`

---

## 2. Le défaut n°1 réel — dérive de vocabulaire CLI ↔ MCP

Le mapping de **namespace** est bon et voulu : `mem_*` (MCP) ↔ `memory *` (CLI). Le problème est dans
quelques **verbes** qui divergent pour le même concept. Un agent qui connaît le MCP doit ré-apprendre
le verbe CLI (et inversement) — c'est la charge cognitive réelle.

| Concept | MCP | CLI | Aligné ? | Action proposée |
|---------|-----|-----|:--------:|-----------------|
| Chercher | `mem_search` | `memory query` | ❌ | Canonical `memory search`, **alias** `query` |
| Lire un item | `mem_get` | `memory show` | ❌ | Canonical `memory get`, **alias** `show` |
| Créer | `mem_save` | `memory add` | ❌ | Canonical `memory save`, **alias** `add` |
| Supprimer | `mem_delete` | `memory rm` | ❌ | Canonical `memory delete`, **alias** `rm` |
| Distiller / cluster | `mem_distill` | `memory digest` | ❌ | Aligner sur `memory distill`, **alias** `digest` |
| Recap session | `mem_session_end` | `session end` | ⚠️ | Ajouter alias `memory session-end` (optionnel) |
| Échec | `mem_tried` | `memory tried` | ✅ | — |
| Vérifier staleness | `mem_verify` | `memory verify` | ✅ | — |
| Pour des fichiers | `mem_for_files` | `memory for-files` | ✅ | — |
| Approuver/rejeter/pending/update/feedback/timeline/suggest-topic/conflict-candidates | `mem_*` | `memory *` | ✅ | — |
| Pré-commit | `pre_commit_check` | `precommit` / `enforce check` | ⚠️ | voir §5 (I4) |
| Journal runtime | `runtime_journal_append/tail` | `runtime append/tail` | ✅ | — |
| Code map / search | `code_map` / `code_search` | `index` / `code-search` | ⚠️ | voir §5 (I3) |

**Verdict :** 5 verbes à aligner (`search`, `get`, `save`, `delete`, `distill`). Tout par **alias**, donc
zéro casse : l'ancien nom reste, l'aide montre le canonique. C'est 90 % de la valeur de cohérence pour
un effort minimal.

---

## 3. Golden path — le documenter explicitement (il existe déjà)

Le « chemin de 10 commandes » réclamé existe déjà en code (la liste `CORE_*`). Il faut surtout le
**rendre visible** (README + `haive --help`). Cycle de vie réel d'un dev/agent :

```
1. haive init                 # une fois — crée .ai/ + bridges + AGENTS.md
2. haive doctor               # vérifier l'installation
3. haive agent setup          # câbler le mode agent (MCP, hooks)
4. haive briefing             # (ou MCP get_briefing) — feedforward avant d'éditer
5. haive memory save|tried    # capturer décision/gotcha/échec
6. haive memory search|get    # retrouver
7. haive sensors check        # feedback sur le diff
8. haive enforce finish       # gate de sortie
9. haive sync                 # staleness + bridges
10. haive session end         # recap pour la prochaine session
```

Côté MCP, le golden path = le profil `enforcement` (déjà le défaut). **Les deux sont cohérents** une
fois les 5 verbes du §2 alignés.

---

## 4. Ce qu'il ne faut PAS faire — démentir les faux « doublons »

| « Doublon » allégué | Réalité (vérifiée dans le code) | Verdict |
|---------------------|----------------------------------|---------|
| `bench` vs `benchmark` | `bench` = self-test latence/payload des outils MCP locaux (`perf_hooks`, `ScenarioResult`). `benchmark` = mesure de valeur haive-vs-plain sur traces d'agent (`AgentBenchmarkRow`, fixtures). | **Pas un doublon** — mais noms ambigus (→ I2) |
| `observe` vs `runtime-journal` | `observe` = endpoint hook PostToolUse (capture passive → `observations.jsonl`). `runtime` = append/tail du journal NDJSON. | **Pas un doublon** — fonctions distinctes |
| `memory-*` (CLI) vs `mem-*` (MCP) | Parité voulue à deux façades (architecture `2026-06-02-architecture-cli-command-surface`). Un cœur, deux surfaces minces. | **Pas un doublon** — c'est l'archi |

Conclusion : **rien à fusionner.** Le travail est d'**aligner les verbes** et de **grouper l'avancé**,
pas de supprimer des outils.

---

## 5. Défauts secondaires + plan

### I2 — `bench` / `benchmark` : noms quasi identiques, jobs différents
- **Proposition :** `bench` (self-test) → sous `doctor` : `haive doctor --selftest` (ou `haive doctor bench`),
  garder `bench` en alias caché. `benchmark` (mesure de valeur) → le rapprocher de la famille mesure
  (`haive eval agents` ou rester `benchmark` mais documenté distinctement). Au minimum : **ne jamais
  laisser les deux noms voisins coexister sans désambiguïsation dans le help.**

### I3 — 18 commandes avancées encore à plat → grouper par verbe
Regroupements naturels (toujours en gardant les anciens noms comme alias) :

| Famille proposée | Absorbe |
|------------------|---------|
| `haive index {code, code-search, embeddings}` | `index`, `code-search`, `embeddings` |
| `haive report {dashboard, stats, impact, playback}` | `dashboard`, `stats`, `playback` (+ `memory impact`) |
| `haive eval {run, agents, baseline, compare}` | `eval`, `benchmark`, `bench`(?) |
| `haive runtime {append, tail, observe, snapshot}` | `observe`, `snapshot` (déjà `runtime {append,tail}`) |
| (sous `enforce`) | `precommit`, `install-hooks` → voir I4 |

`welcome`, `resolve-project`, `hub`, `ingest`, `tui` restent top-level (justifiés).

### I4 — recouvrement `enforce` / `precommit` / `install-hooks`
- `install-hooks` (top-level) **et** `enforce install` installent des hooks → faire de `install-hooks`
  un **alias** de `enforce install`.
- `precommit` (top-level) est la variante manuelle de `enforce check` / `pre_commit_check` (cf. commentaire
  `index.ts:140`) → alias de `enforce check`.

---

## 6. Plan d'exécution — non-breaking, par phases

> Règle d'or : **aucun rename dur.** Chaque changement = nouveau nom canonique + ancien en
> `.alias()` caché + une note de dépréciation douce dans le help. La parité CLI↔MCP doit pointer
> vers un cœur unique (`@hiveai/core`), façades minces (convention `2026-06-02-architecture-cli-command-surface`).

| Phase | Contenu | Effort | Valeur | Risque |
|-------|---------|:------:|:------:|:------:|
| **A** | Aligner 5 verbes `memory` sur le MCP (`search/get/save/delete/distill` canoniques, anciens en alias) | S | **élevée** | nul (alias) |
| **B** | Documenter le golden path (README + help) — rendre visible l'existant | S | élevée | nul |
| **C** | Désambiguïser `bench`/`benchmark` (I2) | S | moyenne | faible |
| **D** | Folder `install-hooks`→`enforce install`, `precommit`→`enforce check` (alias) (I4) | M | moyenne | faible |
| **E** | Grouper l'avancé en familles `index`/`report`/`eval`/`runtime` (alias) (I3) | M | moyenne | faible |

**Tests :** chaque alias doit avoir un test « ancien nom == nouveau nom » pour garantir la non-régression.
Le golden path doit avoir un snapshot test du `--help` par défaut (≤ 12 lignes de commandes).

---

## 7. Mesure de succès

- `haive --help` (sans `--advanced`) : ≤ 12 commandes, toutes du golden path. ✅ déjà ~le cas, à figer en test.
- Pour les 5 verbes de §2 : `mem_X` (MCP) et `memory X` (CLI) partagent le **même verbe** canonique.
- Aucune paire de noms top-level distants de < 2 caractères d'édition sans désambiguïsation (tue `bench`/`benchmark`).
- Aucun outil supprimé ; aucune commande existante cassée (suite d'alias verte).

---

## 8. Statut d'exécution (2026-06-02)

| Phase | Statut | Version |
|-------|--------|---------|
| **A** — aligner 5 verbes `memory` sur le MCP | ✅ livré | v0.13.2 |
| **B** — rendre le golden path visible (README + help) | ✅ livré | v0.13.3 |
| **(racine)** — commit de release atomique (plus de `[skip ci]` en tip) | ✅ livré | v0.13.4 |
| **C** — désambiguïser `bench` → `selftest` (alias `bench`) | ✅ livré | v0.13.5 |
| **D** — `install-hooks`/`precommit` étiquetés équivalents `enforce` | ✅ livré | v0.13.5 |
| **E** — groupement par familles dans `--advanced` help | ✅ livré (partiel) | v0.13.5 |

**E — précision sur le périmètre.** Le groupement *de découvrabilité* (familles dans `--advanced`)
est livré. Le **regroupement d'arbre profond** (déplacer `dashboard`/`stats` sous un parent `report`,
ou `code-search`/`embeddings` sous `index`) est **délibérément différé** : `report` est déjà une
sous-commande de `benchmark` et `index` est une commande-feuille — ces déplacements exigeraient de
**renommer de l'existant**, donc seraient *breaking*, ce qui viole la règle d'or non-breaking de cette
carte. Le faire proprement nécessiterait soit une dépréciation en plusieurs étapes, soit l'accord
explicite d'introduire une rupture — à décider séparément.
