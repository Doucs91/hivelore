# hAIve — Plan d'implémentation concurrentiel (exécution parallèle 3 agents)

> **But du document.** Découper le battle plan (`docs/HAIVE_BATTLE_PLAN_COMPETITIVE_POSITIONING.md`)
> en **3 lots de code indépendants** exécutables en parallèle par 3 agents, sans conflit de merge.
> Chaque lot a son brief détaillé sous `docs/agent-briefs/`.
>
> _Créé : 2026-06-03 (hAIve v0.17.0). Branche de travail : `develop`._

---

## 0. Contexte stratégique (à lire avant de coder)

Lecture obligatoire dans l'ordre :
1. `docs/HAIVE_BATTLE_PLAN_COMPETITIVE_POSITIONING.md` — la thèse, le scorecard, les 2 risques.
2. `.ai/project-context.md` — l'architecture des 4 packages.
3. Ce document — le découpage et les règles anti-conflit.
4. Ton brief : `docs/agent-briefs/LOT-{A,B,C}-*.md`.

**La thèse en une ligne :** le moat de hAIve (enforcement repo-spécifique + boucle mesurée) **existe déjà
dans le code mais est invisible en session #1**. Le risque mortel (§7.1 du battle plan) est le *timing* :
on vend notre force au moment où l'utilisateur ne peut pas encore la ressentir. Ces 3 lots attaquent
exactement ça : rendre la valeur **perceptible tôt**, **élargir le reach**, **prouver par les chiffres**.

**Constat clé :** la plupart des moteurs existent déjà (`seed-git`, `findings`, `init-stack-packs`,
`dashboard`, `prevention`, `impact`, `gate-precision`). Le travail est de l'**orchestration**, de la
**restitution** et de l'**extension** — pas de la réécriture de core engines.

---

## 1. Les 3 lots

| Lot | Thème | Priorités battle plan | Agent |
|-----|-------|----------------------|-------|
| **A** | Onboarding & Cold-start | **P0** | `feature/cold-start` |
| **B** | Valeur visible & preuve | **P1 + P4 + P5** | `feature/visible-value` |
| **C** | Reach & feedforward | **P2 + P3** | `feature/reach` |

### Lot A — Onboarding & Cold-start (`feature/cold-start`)
**Mission :** `haive init` ne finit plus sur un `.ai/` vide. Il détecte le stack, seed depuis l'historique
git (reverts/hotfix), charge les stack-packs, propose les findings CI, et **termine par un rapport
« voici ce que j'ai trouvé pour toi »**. Tue le cold-start = tue le risque §7.1.
**Brief :** `docs/agent-briefs/LOT-A-cold-start.md`

### Lot B — Valeur visible & preuve (`feature/visible-value`)
**Mission :** rendre le moat (enforcement mesuré) **lisible en 10 secondes**. Résumé « caught-for-you »
de fin de session, trend de prévention en tête du dashboard, eval-gate de précision en CI, et un
**chiffre de benchmark publiable**. C'est le « aha » qu'aucun concurrent ne reproduit.
**Brief :** `docs/agent-briefs/LOT-B-visible-value.md`

### Lot C — Reach & feedforward (`feature/reach`)
**Mission :** sortir du MCP-only. Générer des **bridges natifs** (Cline, Windsurf, Continue, Cody, Zed,
Codex/AGENTS.md) depuis le même corpus, avec les sensors `block` exportés dedans. Et rendre le
feedforward indéniablement meilleur : **code-map actif dans `get_briefing`** (zéro grep pour localiser
un symbole).
**Brief :** `docs/agent-briefs/LOT-C-reach-feedforward.md`

---

## 2. Règles anti-conflit (NON NÉGOCIABLES)

Trois agents en parallèle = risque de conflit sur les fichiers de glue partagés. Règles pour l'éviter :

### 2.1 Propriété exclusive des fichiers
Chaque brief liste les fichiers **possédés** par son lot. **Ne modifie jamais un fichier possédé par un
autre lot.** Si tu en as besoin, c'est un *point de coordination* (voir §2.3), pas une édition directe.

### 2.2 Les 3 fichiers de glue partagés — convention d'ajout
Ces fichiers sont touchés par plusieurs lots. **Append-only, blocs séparés, jamais de réécriture :**

- **`packages/cli/src/index.ts`** (enregistrement des commandes CLI) — ajoute tes `import { registerX }`
  et tes `registerX(program)` **à la fin de leurs blocs respectifs**, une ligne par commande. N'insère
  pas au milieu. Ordre d'apparition = ordre d'ajout.
- **`packages/mcp/src/server.ts`** (enregistrement des tools MCP) — même règle : nouveau tool = un bloc
  d'import en fin de liste d'imports + un bloc d'enregistrement en fin de zone d'enregistrement.
- **`packages/core/src/config.ts`** (schéma de config) — si tu ajoutes un champ de config, ajoute-le dans
  un bloc commenté `// --- Lot X ---` à la fin de l'objet concerné. Ne renomme/réordonne rien.

Si un conflit survient malgré tout sur ces 3 fichiers : il est **trivial à résoudre** (deux ajouts
indépendants). Garde les deux côtés.

### 2.3 Points de coordination explicites (interface, pas édition croisée)
- **`get-briefing.ts` appartient au Lot C.** Le Lot B veut y injecter une « ligne de preuve » (ex :
  *« ce harnais t'a évité N répétitions ce mois-ci »*). **Le Lot B n'édite PAS `get-briefing.ts`.** Il
  expose une **fonction pure dans `core`** (ex. `briefingProofLine(events): string | null`) et documente
  sa signature ici. Le Lot C l'importe et la câble. Coordonnez la signature via ce fichier (PR).
- **`init.ts` appartient au Lot A.** Le Lot C génère des bridges ; si `init` doit appeler le générateur
  de bridges, le Lot C expose une fonction pure (`generateBridges(root, memories)`) et le Lot A l'appelle.
  Tant que ce n'est pas prêt, `init` reste sur les bridges actuels (CLAUDE.md / .cursorrules / copilot).

### 2.4 CHANGELOG.md
Chacun écrit sous une sous-section `### [Unreleased] — Lot X` distincte. Pas de conflit si les en-têtes
diffèrent. La consolidation en une vraie version est faite **par l'humain (Sady) au merge final**.

### 2.5 Versioning / publish
**Aucun agent ne bump la version ni ne crée de tag ni ne publie.** Ce sont des features sur `develop` ;
le bump + tag + `npm publish` sont faits par l'humain après merge et validation. Voir CLAUDE.md §git-sync.

---

## 3. Workflow git de chaque agent

```bash
# 1. Récupérer
git fetch origin
git checkout feature/<ton-lot>        # déjà créée et poussée
git pull origin feature/<ton-lot>

# 2. Coder (uniquement les fichiers possédés par ton lot + glue partagée en append-only)

# 3. Qualité locale AVANT commit
pnpm -r build
pnpm -r typecheck
pnpm -r test
#   (les tests des autres lots doivent rester verts ; tu n'as touché que ta zone)

# 4. Commit + push sur TA branche (pas sur develop directement)
git add <tes fichiers>
git commit -m "feat(lot-X): <ce que tu as fait>"
git push origin feature/<ton-lot>

# 5. Ouvrir une PR feature/<ton-lot> -> develop quand le lot est fini.
#    Le merge dans develop est validé après revue (humain ou /code-review).
```

**Entrée (avant de coder) :** `git pull` ta branche, vérifie qu'aucun marqueur de conflit ne traîne.
**Sortie (lot fini) :** `pnpm -r build && pnpm -r typecheck && pnpm -r test` verts, PR ouverte vers `develop`.

---

## 4. Definition of Done globale (par lot)

Un lot est « fini » quand :
1. Tous ses livrables (listés dans son brief) sont implémentés.
2. `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test` passent.
3. De nouveaux tests couvrent la logique pure ajoutée (core = fonctions pures, faciles à tester).
4. Une PR `feature/<lot>` → `develop` est ouverte avec un résumé des changements.
5. Aucun fichier possédé par un autre lot n'a été modifié.

---

## 5. Carte de propriété des fichiers (résumé)

| Fichier / zone | Propriétaire |
|---|---|
| `cli/commands/init*.ts`, `welcome.ts`, `ingest.ts` | **Lot A** |
| `core/seed-git.ts`, `findings.ts`, `seed.ts`, `topic-suggest.ts` | **Lot A** |
| `core/dashboard.ts`, `prevention.ts`, `impact.ts`, `gate-precision.ts`, `eval*.ts` | **Lot B** |
| `cli/commands/dashboard.ts`, `session-end.ts`, `eval.ts`, `benchmark.ts`, `bench.ts`, `stats.ts` | **Lot B** |
| `scripts/agent-roi-benchmark.mjs` + nouveaux scripts bench | **Lot B** |
| `cli/commands/sync.ts` + nouveaux générateurs de bridges | **Lot C** |
| `mcp/tools/get-briefing.ts`, `core/briefing-body.ts`, `briefing-preset.ts` | **Lot C** |
| `core/code-map.ts`, `token-budget.ts`, `mcp/tools/code-map.ts` | **Lot C** |
| `cli/src/index.ts`, `mcp/src/server.ts`, `core/src/config.ts` | **PARTAGÉ — append-only (§2.2)** |

Tout fichier non listé : si tu dois le toucher, vérifie qu'il n'est pas la zone d'un autre lot ; en cas
de doute, demande à l'humain plutôt que d'éditer.
