# Plan détaillé — hAIve

> **hAIve** (mélange de *hive* et *AI*) — couche de mémoire IA persistante et synchronisée pour les équipes.
> Document de référence pour reprendre le travail à froid après fermeture de session.
> Dernière mise à jour : 2026-04-25

---

## 1. Vision

Construire un outil **agnostique** (compatible Claude Code, Cursor, Copilot, Continue, etc. via MCP) qui résout 3 problèmes liés au travail d'équipe avec des assistants IA sur un projet de code :

1. **Onboarding redondant** : N développeurs = N analyses initiales identiques du même projet.
2. **Perte de mémoire personnelle inter-machines** : la compréhension acquise par l'IA d'un dev disparaît dès qu'il change de machine ou ferme sa session.
3. **Pas de synchronisation des apprentissages spécialisés** : les savoirs gagnés par chaque IA (ex: "champ X retiré par décision légale") ne se propagent pas aux IA des autres collègues.

But final : toutes les IA d'une équipe partagent une compréhension commune du projet et continuent à enrichir cette compréhension de manière collaborative, sans noyer chaque IA d'informations non pertinentes.

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
- **Build / Test** : `tsup` (build) + `vitest` (test).
- **Agnostique** : exposé via **MCP** (Model Context Protocol) pour fonctionner avec Claude Code, Cursor, Continue, etc.
- **Bootstrap initial** : **délégué à l'IA déjà ouverte chez le dev** via un outil exposé par le serveur MCP.
  - Avantages : aucune clé API à gérer, vraiment agnostique, l'IA a déjà accès au filesystem.
  - Fallback : appel API direct avec clé configurée (utile en CI pour régénérer).
- **Storage initial** : fichiers + git, pas de DB.
- **Embeddings** : `@xenova/transformers` (Transformers.js), local, modèle léger.
- **Conventions de naming MCP** : suivre le style Engram pour familiarité écosystème (`mem_save`, `mem_search`, `mem_session_start`, etc.).
- **Privacy** : strip automatique des sections `<private>...</private>` dans les contenus de mémoire (inspiré d'Engram).

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

### Mnemo (MnemoAI/mnemo)
- 373 ⭐, Python, framework MCP pour construire des agents avec RAG.
- **Pas un concurrent** : c'est "build your own agent", pas "couche mémoire pour agent existant". Dimension crypto (adresse de contrat dans le README).

### Positionnement hAIve
> **"Explicit team curation"** vs Engram *"invisible individual infrastructure"*.
>
> hAIve cible les **équipes** qui veulent un savoir collectif curé et partagé, pas les solos qui veulent une mémoire perso transparente.

### Stratégie retenue
**Option 1 : construire hAIve from scratch en TS, indépendamment d'Engram.**
- Risque : Engram a 2 mois d'avance et un meilleur runtime de distribution (Go binary).
- Mitigation : se différencier fortement sur l'angle équipe dès la v0.1 (scoping `personal/team/module`, format de mémoire taillé pour la collaboration, bootstrap structuré).
- À surveiller : si Engram pivote vers le team-first, réévaluer (option 4 = bridge MCP avec eux).

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

Côté dev (hors repo) :
- `~/.config/<outil>/personal/` — mémoires personnelles, sync optionnelle entre machines via compte.

Composants logiciels :
1. **CLI** (`<outil>-cli`) : commandes `init`, `memory add|query|validate`, `sync`.
2. **Serveur MCP** : expose `query_memories`, `add_memory`, `get_project_context` à n'importe quel client IA compatible.
3. **Générateur de fichiers de pont** : auto-écrit `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md` qui référencent `.ai/project-context.md`.

---

## 5. Format des fichiers de mémoire

Markdown avec frontmatter YAML :

```markdown
---
id: 2026-04-25-field-x-removed
scope: team                          # personal | team | module
module: transactions                 # optionnel si scope=module
type: decision                       # convention | decision | gotcha | architecture | glossary
status: validated                    # draft | proposed | validated | deprecated | stale
anchor:
  commit: a1b2c3d
  paths:
    - src/transactions/Transaction.ts
  symbols:
    - Transaction.legacyField
tags: [legal, schema-change]
domain: transactions
author: collegue-b@example.com
created_at: 2026-04-25T10:00:00Z
expires_when: null                   # ex: "PR #234 merged"
---

## Contexte
Le champ `legacyField` de `Transaction` a été supprimé.

## Raison
Conformité légale (RGPD article X). Décision validée par l'équipe juridique.

## À retenir
Ne pas réintroduire ce champ. Pour stocker une donnée équivalente, voir le module `audit-log`.
```

---

## 6. Découpe en versions

### v0.1 — Fondations (sans IA, approche B "Personal first")
- Structure de dossier `.ai/`.
- Format de mémoire (frontmatter + validation).
- CLI : `init` (crée `.ai/` + génère fichiers de pont vides), `memory add`, `memory list`, `memory query` (basique, par tags).
- **Approche B pour le scoping** : par défaut, toute nouvelle mémoire est `personal`. Promotion explicite vers `team` via commande dédiée (`hAIve memory promote <id>`).
- Tests unitaires sur le format et le parsing.
- **Pas d'IA orchestrée à ce stade** : `init` génère un squelette à compléter manuellement.

### v0.2 — Intégration MCP — ✅ livrée
- Package `@haive/mcp` créé, expose 5 tools (`mem_save`, `mem_search`, `mem_list`, `get_project_context`, `bootstrap_project_save`) et 1 prompt (`bootstrap_project`).
- Serveur stdio basé sur `@modelcontextprotocol/sdk` (1.29).
- Bin séparé `haive-mcp` + commande `haive mcp` côté CLI qui le spawn.
- Résolution du project root : flag `--root` > env `HAIVE_PROJECT_ROOT` > auto-detect `.ai/`/`.git/`/`package.json`.
- Tools structurés en fonctions pures testables ; serveur n'est qu'un thin wrapper.
- Smoke test JSON-RPC : `initialize` + `tools/list` répondent correctement.
- README étendu avec snippets de config pour Claude Code, Cursor, VS Code.
- 37 tests passent (16 core + 16 mcp + 5 cli).

### v0.3 — Embeddings + filtrage sémantique — ✅ livrée (sauf scoping auto)
- Package `@haive/embeddings` créé (Transformers.js, `Xenova/bge-small-en-v1.5`, 384 dims).
- Modèle téléchargé à la première utilisation, exécuté 100% en local.
- Cache d'embeddings dans `.ai/.cache/embeddings/embeddings-index.json` avec invalidation par hash SHA-256 par entrée.
- CLI : `haive embeddings index | query | status`.
- `mem_search` MCP gagne `semantic: true` + `min_score`. Lazy-load via dynamic import, fallback gracieux vers literal si le package ou l'index manque (`mode: "literal_fallback"` + notice).
- Refactor : interface `EmbedderLike` extraite pour des tests rapides (pas de download du modèle).
- Tests : 17 tests embeddings (cosine, index cache, indexer avec FakeEmbedder).
- 54 tests passent au total (16 core + 17 embeddings + 16 mcp + 5 cli).
- ⚠️ **Reste à faire** : scoping automatique au démarrage d'une tâche (modules touchés). Reporté en v0.4.

### v0.4 et au-delà (idées, à confirmer)
- Workflow PR de mémoire (statut `proposed` → review → `validated`).
- Détection de staleness via vérification d'ancre.
- Validation passive par usage (compteur d'utilisations sans rejet).
- Confidence levels (`unverified | low-confidence | trusted | authoritative`) côté affichage.
- Sync `personal/` multi-machines (compte / cloud léger).
- Service managé optionnel pour grandes équipes.

### v1.0 — approche C "Hybride intelligent"
- Classification automatique heuristique au moment de l'écriture : l'IA propose un scope (`personal` vs `team-proposed`) en fonction du contenu.
- L'utilisateur peut corriger.
- Prend le meilleur des deux mondes (friction nulle + savoir partagé maximal) une fois qu'on a appris des usages réels en v0.x.

---

## 7. Prochaine étape concrète

**Démarrer la v0.1.** Toutes les décisions structurantes sont prises :
- ✅ Nom : **hAIve** (vérifier dispo npm / scope `@haive/*` au moment du scaffolding).
- ✅ Monorepo TS, Node 20 LTS, `tsup` + `vitest`.
- ✅ Bootstrap délégué à l'IA cliente via outil MCP.
- ✅ Approche B pour le scoping en v0.1 (Personal first), C en v1.0.
- ✅ Différenciation vs Engram : team-first explicit curation.

**Plan d'implémentation v0.1** (à détailler au moment de coder) :
1. Scaffolding monorepo (`pnpm` workspaces ou `turborepo` à choisir).
2. Package `@haive/core` : types, schéma frontmatter, parser/sérialiseur, validateur.
3. Package `@haive/cli` : commandes `init`, `memory add|list|query|promote`.
4. Tests vitest sur core.
5. Documentation README minimale.

Le serveur MCP (`@haive/mcp`) arrive en v0.2.

---

## 8. Glossaire interne

- **Ancre** : référence stable d'une mémoire à un point précis du code (commit + fichier + symbole).
- **Pont** : fichier généré (`CLAUDE.md`, `.cursorrules`, etc.) qui rend l'outil compatible avec des clients IA non-MCP.
- **Scope** : espace de visibilité d'une mémoire (`personal`, `team`, `module`).
- **Bootstrap** : analyse initiale d'un projet par l'IA pour produire `project-context.md`.
