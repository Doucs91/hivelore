# Plan détaillé — hAIve

> **hAIve** (mélange de *hive* et *AI*) — couche Git-native de contexte, mémoire et policy gates pour les harnesses d'agents de code.
> Document de référence pour reprendre le travail à froid après fermeture de session.
> Dernière mise à jour : 2026-06-02
>
> ⚠️ **Document historique de conception (design doc).** La vision (§1) et les décisions architecturales
> (§2) restent valables, mais l'**historique des versions** (§6) s'arrête à v0.2.16 et la **roadmap v0.3**
> (§7) a depuis été livrée (code-map dans le briefing, TUI/cockpit, workflow `proposed → validated`).
> Pour l'**état courant du produit** (v0.26.1) : voir le `README.md`, le `CHANGELOG.md`, et
> `docs/HAIVE_BATTLE_PLAN_COMPETITIVE_POSITIONING.md`. Faits notables livrés depuis : 12 ponts natifs,
> cold-start (stack packs + seed-git + `ingest`) avec plancher de qualité, sensors exécutables dans le
> gate, et la boucle mesurée (prevention/impact/eval).

---

## 1. Vision

Construire un outil **agnostique** (compatible Claude Code, Cursor, Copilot, Continue, etc. via MCP) qui résout 3 problèmes liés au travail d'équipe avec des assistants IA sur un projet de code :

1. **Onboarding redondant** : N développeurs = N analyses initiales identiques du même projet.
2. **Perte de mémoire personnelle inter-machines** : la compréhension acquise par l'IA d'un dev disparaît dès qu'il change de machine ou ferme sa session.
3. **Pas de synchronisation des apprentissages spécialisés** : les savoirs gagnés par chaque IA (ex: "champ X retiré par décision légale") ne se propagent pas aux IA des autres collègues.

But final : toutes les IA d'une équipe partagent une compréhension commune du projet et continuent à enrichir cette compréhension de manière collaborative, sans noyer chaque IA d'informations non pertinentes.

Positionnement actuel : hAIve n'est pas une mémoire générale ni un dashboard d'agent. C'est la couche
**repo-native context policy** du harness : briefing feedforward avant travail, mémoires Markdown
ancrées au code, sensors déterministes, hooks/Git/CI enforcement, et evals répétables pour mesurer que
la bonne connaissance et les bons garde-fous ressortent encore.

---

## 2. Décisions architecturales sur les 6 défis

### 2.1 Validation et résolution de conflits

**Principe directeur** : aucune review humaine obligatoire par défaut. La review est optionnelle et n'intervient que pour une minorité de cas. Sinon → adoption tuée par la friction.

**3 catégories de mémoires, 3 traitements** :
1. **Auto-validées (~70-80%)** : tout ce qui est vérifiable contre le code (l'IA relit et confirme). Aucune intervention humaine.
2. **Validées par piggy-back sur PR de code (~10-20%)** : les mémoires liées à un changement de code sont attachées à la PR correspondante, reviewées avec le diff dans le même flow.
3. **Vraie review humaine (<10%)** : uniquement pour les conflits, le soft knowledge non vérifiable, et les promotions `personal → team`.

**Statuts** : `draft` → `proposed` → `validated` → `deprecated` | `stale`.

**Mécanismes anti-friction** :
- **Validation passive par usage** : une mémoire consommée N fois par différents devs sans correction passe automatiquement à `validated`.
- **Default to rejection** : on n'exige pas une approbation positive ; les mémoires `proposed` sont visibles/utilisables avec étiquette "non vérifié", on attend qu'on les rejette.
- **Confidence levels** plutôt qu'états binaires côté affichage : `unverified | low-confidence | trusted | authoritative`. L'IA consommatrice pondère elle-même.
- **Batch digest hebdomadaire** : récap des nouvelles mémoires team de la semaine, validation/rejet en bulk.
- **Asymétrie de confiance par source** : mémoires extraites d'un commit mergé > mémoires d'une session AI fraîche.

**Ancrage et conflits** :
- Toute mémoire est ancrée à `commit SHA + chemin + symbole`. Si l'ancre disparaît ou change → statut auto = `stale`.
- Le code mergé sur `main`/`develop` est la **source de vérité ultime**.
- Sur conflit détecté entre mémoires : l'IA n'écrase rien, elle ouvre une **PR de mémoire**. L'IA avertit l'utilisateur qui décide : confirmer la sync, ou continuer sans sync.

### 2.2 Staleness (mémoire périmée)
- **Ancre obligatoire** (commit SHA + fichier + ligne/symbole) pour toute mémoire technique.
- **Vérification au pull** : avant de servir une mémoire, vérifier l'ancre. Si modifiée → flag `à revalider`.
- **TTL adaptatif** : champ `expires_when` (ex : "PR #123 mergée") en plus de la date.
- **Top stale au démarrage de session** : les 3 mémoires pertinentes mais flagées sont remontées au dev pour revalidation rapide.

### 2.3 Scoping personnel vs équipe
Trois espaces de noms explicites :
- `personal/` — synchronisé entre **mes** machines uniquement (compte dev).
- `team/` — synchronisé pour toute l'équipe.
- `module/<nom>/` — équipe, mais ne se charge que si l'IA travaille sur ce module.

À l'écriture, l'IA propose un scope par défaut (heuristique : "je/mon" → personal ; mention de fichier/architecture/décision → team) et le dev peut corriger.

### 2.4 Filtrage de pertinence
Approche **hybride à deux niveaux** :
- **Tags structurés** (filtrage rapide) : `paths`, `domain`, `type`, `author`, `created_at`.
- **Embeddings** (filtrage sémantique en complément) générés localement.

Au démarrage d'une tâche, pull :
1. Toutes les mémoires `team/` validées.
2. Mémoires des modules touchés.
3. Top-K par similarité sémantique sur la requête en cours.

### 2.5 Source de stockage
**Git-natif d'abord, service managé en option plus tard.**
- Stockage primaire = dossier `.ai/` versionné dans le repo (pour `team/` et `module/`).
- Avantages : zéro infra, ACL/audit/historique gratuits, offline, self-hostable, marche du solo dev à la banque.
- `personal/` : stockage local + sync optionnelle via compte dev.
- Embeddings : générés localement (modèle léger type `bge-small`), cachés.

### 2.6 Bootstrap de la première analyse
- Artefact structuré : markdown avec frontmatter YAML, sections normalisées.
- Sections : architecture, modules clés, conventions, glossaire métier, dépendances critiques, gotchas.
- Généré par commande CLI (`init`) qui orchestre l'IA en mode analyse.
- Committé dans `.ai/project-context.md`.
- **Layered** : fichier racine + un `context.md` par module important, chargé à la demande.
- Diff-friendly : régénération possible, PR montre l'évolution de la compréhension.

---

## 3. Stack & contraintes

- **Langage** : TypeScript (Node).
- **Cible Node minimum** : Node 20 LTS.
- **Structure** : monorepo (CLI + serveur MCP + packages partagés).
- **Build / Test** : `tsup` (build) + `vitest` (test), avec `pnpm@9.14.2` pinned.
- **Quality gate** : `pnpm -r build`, `pnpm check:artifacts`, `pnpm -r typecheck`, `pnpm -r test`,
  puis `haive eval --fail-under 80`. `haive eval` auto-charge `.ai/eval/spec.json` quand présent.
- **Agnostique** : exposé via **MCP** (Model Context Protocol) pour fonctionner avec Claude Code, Cursor, Continue, etc.
- **Bootstrap initial** : **délégué à l'IA déjà ouverte chez le dev** via un outil exposé par le serveur MCP.
  - Avantages : aucune clé API à gérer, vraiment agnostique, l'IA a déjà accès au filesystem.
  - Fallback : appel API direct avec clé configurée (utile en CI pour régénérer).
- **Storage initial** : fichiers + git, pas de DB.
- **Embeddings** : `@xenova/transformers` (Transformers.js), local, modèle léger.

---

## 3bis. Concurrence — analyse stratégique

### Engram (Gentleman-Programming/engram)
- 2 821 ⭐ (mis à jour quotidiennement), créé 2026-02-16, écrit en Go.
- Description : "Persistent memory for AI coding agents. Agent-agnostic."
- **Recouvrement avec hAIve : ~70%** : MCP server, CLI, TUI, HTTP API, git sync entre machines, cloud opt-in, plugins Claude Code/Cursor/Windsurf/etc., 16 outils MCP.
- **Philosophie OPPOSÉE à hAIve** : *"infrastructure invisible, 1 dev, plusieurs machines"*. Leur doc dit : *"If you're thinking about engram while working, something went wrong."*
- **Ce qu'Engram NE fait PAS (= notre différenciation)** :
  - Pas de scoping `team / personal / module` explicite.
  - Pas de workflow PR de mémoire ni de validation collaborative.
  - Pas de bootstrap `project-context.md` structuré.
  - Pas d'ancrage à un commit SHA pour staleness automatique.
  - Pas de chargement automatique par module touché.

### Positionnement hAIve
> **"Repo-native context policy for teams"** vs Engram *"invisible individual infrastructure"*.
>
> hAIve cible les **équipes** qui veulent un savoir collectif curé, auditable, mesurable et enforceable,
> pas les solos qui veulent uniquement une mémoire perso transparente.

---

## 4. Architecture cible

```
votre-projet/
├── .ai/
│   ├── project-context.md          # bootstrap racine (problème 1)
│   ├── modules/
│   │   ├── transactions/context.md # contexte par module
│   │   └── recovery/context.md
│   └── memories/
│       ├── team/                   # mémoires partagées équipe
│       │   ├── 2026-04-decision-no-lodash.md
│       │   └── 2026-04-field-x-removed.md
│       └── module/
│           ├── transactions/
│           └── recovery/
├── CLAUDE.md                       # pont auto-généré, référence .ai/
├── .cursorrules                    # pont auto-généré
└── .github/copilot-instructions.md # pont auto-généré
```

Composants logiciels :
1. **CLI** (`@hiveai/cli`) : commandes `init`, `memory add|list|query|validate`, `sync`, `session end`, `tui`.
2. **Serveur MCP** (`@hiveai/mcp`) : expose tous les outils mémoire + code-map à n'importe quel client IA compatible.
3. **Core** (`@hiveai/core`) : types, schéma frontmatter, parser/sérialiseur, validateur, token-budget, usage stats.
4. **Embeddings** (`@hiveai/embeddings`) : index sémantique local (Transformers.js, bge-small-en-v1.5, 384 dims).

---

## 5. Format des fichiers de mémoire

Markdown avec frontmatter YAML :

```markdown
---
id: 2026-04-25-field-x-removed
scope: team                          # personal | team | module
module: transactions                 # optionnel si scope=module
type: decision                       # convention | decision | gotcha | architecture | glossary | attempt | session_recap
status: validated                    # draft | proposed | validated | deprecated | stale
topic: field-x-removed               # clé stable pour upsert (topic-upsert incrémente revision_count)
revision_count: 0
anchor:
  commit: a1b2c3d
  paths:
    - src/transactions/Transaction.ts
  symbols:
    - Transaction.legacyField
tags: [legal, schema-change]
related_ids:
  - 2026-04-25-convention-audit-log   # mémoires liées (backend↔frontend, cause↔conséquence)
created_at: 2026-04-25T10:00:00Z
expires_when: null
---

## Contexte
Le champ `legacyField` de `Transaction` a été supprimé.

## Raison
Conformité légale (RGPD article X). Décision validée par l'équipe juridique.

## À retenir
Ne pas réintroduire ce champ. Pour stocker une donnée équivalente, voir le module `audit-log`.
```

---

## 6. Historique des versions

### v0.1 — Fondations ✅
- Structure `.ai/`, format mémoire, CLI `init|memory add|list|query|promote`, tests unitaires.

### v0.2 — Intégration MCP ✅
- `@hiveai/mcp` avec `mem_save`, `mem_search`, `mem_list`, `get_project_context`, `bootstrap_project_save`, prompt `bootstrap_project`.
- Serveur stdio `haive-mcp`, résolution projet root, tests JSON-RPC.

### v0.3 — Embeddings + filtrage sémantique ✅
- `@hiveai/embeddings` (Transformers.js, bge-small-en-v1.5, 384 dims).
- CLI `haive embeddings index|query|status`.
- `mem_search` MCP gagne `semantic: true`, fallback gracieux vers literal.
- Interface `EmbedderLike` pour tests rapides (FakeEmbedder).

### v0.2.10 — Token economy + code-map ✅
- `get_briefing` : one-shot onboarding, budget tokens configurable, priorise `attempt` + mémoires fréquentes.
- `haive index code` : code-map JSON multi-langages (TS/JS/Java/Kotlin/Python/Go/Rust/C#/PHP).
- `code_map` MCP tool, `mem_for_files` amélioré (path-segment matching).
- CLI `haive briefing` avec OR fallback si AND donne 0 résultats.
- `mem_observe` MCP tool pour capturer des découvertes code en cours de session.

### v0.2.12 — Features Engram-inspired ✅
- **Topic upsert** : `--topic` sur `haive memory add` + `topic` param sur `mem_save` → update en place (revision_count++).
- **Déduplication par hash** : `mem_save` et `haive memory add` rejettent un corps identique à un existant.
- **Conflict detection** : `similar_found[]` dans la réponse `mem_save` si des mémoires proches existent.
- **`mem_session_end` MCP + `haive session end` CLI** : récap structuré de fin de session, upsert par topic, surfacé automatiquement dans `get_briefing`.
- **`post_task` amélioré** : Question 0 (gotchas découverts) + Question 6 (appel à `mem_session_end`).
- **`session_recap` type** : nouveau type de mémoire, exclu des recherches, surfacé uniquement dans `get_briefing.last_session`.

### v0.2.13–0.2.15 — Bugfixes & polish ✅
- `session_recap` exclu de `memory query`, `mem_for_files`, `haive sync` staleness.
- Auto-revalidation des `session_recap` stales hérités.
- OR fallback dans `get_briefing` (MCP) et `haive briefing` (CLI).
- `haive init` : message post-init actionnable avec `bootstrap_project`.
- ID récap simplifié : `…-session_recap-recap` (plus `…-session_recap-session-recap`).

### v0.2.16 — Anchor validation + CI verify + template warning ✅
- **Anchor path validation** : `haive memory add` et `mem_save` avertissent si les `--paths` n'existent pas dans le projet (chemins invalides → stale immédiat).
- **`haive memory verify` dans le CI** : template `--with-ci` inclut un job `pr-stale-check` qui commente sur la PR si des mémoires stales sont détectées.
- **Warning template `project-context.md`** : `haive briefing` et `get_briefing` détectent si le fichier contient encore le boilerplate généré par `haive init` et affichent un avertissement actionnable ; le contenu template est supprimé du budget tokens.

---

## 7. Roadmap v0.3 (prochaine version majeure)

### 7.1 `get_briefing` intègre le code-map activement
Actuellement le code-map (`haive index code`) est passif : il faut que l'IA appelle explicitement `code_map`. En v0.3, `get_briefing` répond aux questions "où se trouve X ?" directement, sans grep.

**Plan d'implémentation :**
- `get_briefing` accepte un nouveau paramètre `symbols?: string[]`.
- Si fourni, interroge `.ai/code-map.json` pour ces symboles et injecte les résultats dans la réponse, sous un budget séparé.
- CLI : `haive briefing --symbols PaymentService,TenantFilter`.
- Objectif : zéro appel grep/find pour la localisation de symboles.

### 7.2 Dashboard TUI `haive tui` fonctionnel
Actuellement `haive tui` est un stub (Ink/React sans contenu). En v0.3, il devient un vrai tableau de bord interactif.

**Écrans prévus :**
1. **Vue mémoires** : liste paginée, filtres scope/type/status, prévisualisation inline.
2. **Vue santé** : mémoires stales / anchorless / à valider, alertes par criticité.
3. **Vue stats** : top mémoires lues, decay warnings, budget tokens consommé.
4. **Actions** : approve / reject / promote / delete directement depuis la TUI.

### 7.3 Peer-review `proposed → validated`
Actuellement la mécanique de statut existe mais n'a pas de workflow réel. En v0.3, on complète le cycle.

**Plan d'implémentation :**
- `haive memory pending` liste les mémoires `proposed` en attente de review.
- `haive memory digest` : rapport hebdomadaire des nouvelles mémoires team (Markdown, envoyable par email/Slack).
- `get_briefing` signale les mémoires `proposed` avec un flag `⚠ unverified` dans le résultat.
- Confiance multi-niveau dans le format de sortie : `draft | proposed | validated | authoritative`.
- Auto-promotion par usage : si une mémoire `proposed` est consommée N fois sans rejet → `validated`.

---

## 8. Glossaire interne

- **Ancre** : référence stable d'une mémoire à un point précis du code (commit + fichier + symbole).
- **Pont** : fichier généré (`CLAUDE.md`, `.cursorrules`, etc.) qui rend l'outil compatible avec des clients IA non-MCP.
- **Scope** : espace de visibilité d'une mémoire (`personal`, `team`, `module`).
- **Bootstrap** : analyse initiale d'un projet par l'IA pour produire `project-context.md`.
- **Topic upsert** : mise à jour en place d'une mémoire identifiée par sa clé `topic` + `scope`, incrémentant `revision_count`.
- **session_recap** : mémoire spéciale capturant le bilan d'une session de travail ; surfacée en tête du prochain `get_briefing`.
- **Code-map** : index JSON compact (`fichier → exports + description JSDoc`) utilisé pour répondre aux questions de localisation de symboles sans grep.
