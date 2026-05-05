# Spécification — inspirations Engram, rester team-first (hAIve)

## Formule courte

**Vérité durable : Git + équipe** (`.ai/memories/`, PRs, mono ou multi-dépôt via `crossRepoSources`).  
**Emprunt à l’esprit Engram :** meilleure **récupération**, **réduction du bruit**, et **continuité de session** — soit sur les mêmes markdown d’équipe, soit via une **couche runtime jetable** (`.ai/.runtime/`) qui ne remplace jamais les mémoires promues.

## Modèle à deux couches

| Couche | Rôle | Versionné |
|--------|------|-----------|
| **Mémoires** | Conventions, décisions, gotchas, archi — source de vérité | Oui (Git) |
| **Runtime** | Brouillons, journal de session machine-locale, caches non partagés | Non (voir `.gitignore` sous `.ai/.runtime/`) |

## Progressive disclosure (outils MCP)

1. **`get_briefing`** — premier appel : contexte projet, récap session, mémoires classées sous budget.
2. **`mem_relevant_to`** / **`mem_search`** — exploration ciblée ; `mem_search` peut utiliser le **classement lexical** (`lexical_rank`) pour les requêtes type phrase sans index sémantique.
3. **`mem_get`** — corps complet quand un id est connu.

## Résolution de projet (multi-racine / Cursor)

- **`mem_resolve_project`** (MCP) et **`haive resolve-project`** (CLI) renvoient toujours un JSON structuré et **ne lèvent pas** d’erreur fatale : racine résolue, `HAIVE_PROJECT_ROOT` si défini, présence de `.ai/` et de `memories/`.

## Sujets / topics (clés stables)

- **`mem_suggest_topic`** + **`haive memory suggest-topic`** : proposent une clé `topic` de style `famille/slug` (ex. `architecture/…`, `bug/…`, `decision/…`) alignée sur le `type` de mémoire, pour le pattern topic-upsert déjà présent dans le frontmatter.

## Conflits

- **`mem_conflicts_with`** reste l’outil principal (heuristiques + sémantique optionnelle).
- **`mem_conflict_candidates`** : scan **léger sans id cible** — paires de mémoires (types `decision` / `architecture` par défaut) à fort recouvrement lexical (Jaccard) sur le titre / l’identité, pour alimenter une revue humaine ou un appel suivant à `mem_conflicts_with`.

## Chronologie

- **`mem_timeline`** : à partir d’un **`memory_id`** et/ou d’un **`topic`**, liste des mémoires liées (`related_ids`, même `topic`, ancres qui se recoupent), tri chronologique (`created_at`).

## Phases (traces d’implémentation)

| Phase | Contenu |
|-------|---------|
| **P0** | `mem_resolve_project`, progressive disclosure (descriptions), `mem_suggest_topic`, `.ai/.runtime/` + gitignore interne, `lexical_rank` sur `mem_search` |
| **P1** | `mem_timeline`, `mem_conflict_candidates`, équivalents CLI là où utile |
| **P2** | Extensions futures (journal de session dans runtime, autres signaux de conflit) sans dupliquer la logique riche de `mem_conflicts_with` |

## Cartographie des outils existants

- Recherche : `mem_search`, `mem_relevant_to`, embed index (`semantic`).
- Conflits par id : `mem_conflicts_with`.
- Briefing / onboarding : `get_briefing`, `get_recap`.
- Hub / multi-repo : config `crossRepoSources`, sync — inchangés par cette spec.
