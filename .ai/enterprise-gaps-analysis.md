# Analyse — Ce qui manque à hAIve pour les grandes organisations

> Rédigé le 2026-05-06. Révisé le 2026-05-06 (intégration revue technique + 3 gaps additionnels).
> Contexte : hAIve v0.9.x, stockage git-natif, scope personal/team/module, 41 MCP tools, 50+ commandes CLI, `haive hub` (cross-repo via repo git partagé) déjà présent.

---

## Diagnostic général

hAIve a la bonne philosophie et la bonne fondation architecturale (git-natif + MCP agnostique).
Les manques ne sont pas des refactorisations — ce sont des **couches supplémentaires** à empiler.
Le vrai blocant : hAIve est aujourd'hui un outil **par repo**, alors que les grandes orgs sont **multi-repo**.

---

## Les 5 gaps critiques (par ordre de priorité)

### 1. Mémoire cross-repo — scope `org/` (BLOCANT #1)

**Problème** : une grande org a 50–200 repos. Les connaissances transversales existent partout :
décisions légales, conventions d'architecture globales, gotchas sur des services partagés (auth, paiement…).
Aujourd'hui, une mémoire `team/` est invisible hors du repo où elle est écrite.

**Ce qui manque** :
- Un scope `org/` au-dessus de `team/`
- Une couche de synchronisation centralisée entre repos
- Un mécanisme de promotion `team → org` avec gouvernance

**Demi-pas déjà fait — `haive hub`** : la commande `hub init|push|pull|status` implémente déjà un proto cross-repo via un repo git central avec scope `shared/<source-project>/`. Le travail réel n'est donc pas "tout construire" mais **promouvoir `hub` au rang de scope `org/` first-class** :
- Renommer/aliaser `shared` → `org` dans le schema
- Index sémantique cross-repo (federated search via embeddings agrégés)
- Workflow de promotion `team → org` matérialisé par une PR sur le repo hub
- Pull automatique au `get_briefing` (pas seulement à la commande explicite)

**Impact** : sans ça, hAIve reste un outil d'équipe. Il ne peut pas prétendre être un outil d'organisation.

---

### 2. Serveur central + analytics (buy-in direction)

**Problème** : le stockage git-natif bloque trois besoins enterprise critiques :
- Chercher dans les mémoires de *toutes* les équipes simultanément
- Mesurer le ROI ("combien d'heures économisées ?", "quelles mémoires sont les plus consommées ?")
- Piloter la santé globale de la base de connaissance

**Sans métriques, le CTO ne signe pas.** Il faut :
- Un serveur central (self-hosted ou cloud) avec API
- Un dashboard admin : santé, usage, top mémoires, équipes contributives
- Des métriques exportables (Datadog, Grafana, etc.)

**Framing produit indispensable (sinon "dashboard analytics" reste une promesse vide)** :
- **Calcul d'heures économisées** : mémoires consommées × coût onboarding évité (variable configurable par l'org)
- **Leaderboard équipes contributives** : gamification douce qui déclenche l'adoption descendante (CTO → tech leads)
- **Alertes santé proactives** : mémoires stales > X%, équipes à 0 contribution depuis 30j, modules sans `project-context.md`
- **Rapport mensuel auto-généré** au format PDF/Markdown, envoyable au COMEX

**Note** : l'architecture actuelle peut évoluer proprement — le serveur devient un backend optionnel,
le git-natif reste le default pour petites équipes.

---

### 3. Curation IA automatique à l'échelle

**Problème** : 50 devs × 10 sessions/semaine = 500 `session_recaps` par semaine.
Aucune équipe ne peut reviewer ça manuellement. La base de mémoire se dégrade avec la taille.

**Ce qui manque** :
- Une couche IA méta qui distille automatiquement les recaps en mémoires canoniques
- Déduplication cross-équipes (pas juste intra-repo)
- Escalade humaine seulement pour les vrais conflits ou promotions `team → org`
- Auto-dépréciation intelligente (détecte qu'un package référencé a changé de version majeure)

---

### 4. Intégrations dans les outils existants

**Problème** : les grandes orgs ne changent pas leurs workflows — elles y branchent les nouveaux outils.
Si hAIve force à ouvrir un TUI ou un terminal, l'adoption sera nulle hors des dev early adopters.

**Ce qui manque** :
- **Slack** : digest hebdomadaire des nouvelles mémoires team, validation/rejet en 1 clic depuis Slack
- **GitHub / GitLab PR** : commentaire automatique "ces mémoires sont pertinentes à ce diff"
- **JIRA / Linear** : lier une mémoire à un ticket pour contexte complet
- **Confluence / Notion** : export/import de la base de connaissance

---

### 5. Memory-as-code CI gate (quick win sous-estimé)

**Problème** : aujourd'hui une mémoire critique (`decision`, `gotcha`, `architecture`) ancrée à `src/payment/Charge.ts` peut devenir obsolète sans rien casser. Le code passe la CI, la mémoire reste mais ment. Personne ne s'en rend compte avant qu'un dev IA s'appuie dessus.

**Ce qui manque** :
- Une GitHub Action / GitLab CI qui **fait échouer la PR** si elle touche un fichier ancré par une mémoire `validated` non revalidée dans le diff
- Un commit-status `haive/memory-check` qui devient un required check
- Un commentaire automatique listant les mémoires impactées avec leur `id`

**Pourquoi c'est stratégique** : c'est ce qui transforme hAIve d'un *"outil sympa que les devs ouvrent quand ils y pensent"* en **infrastructure obligatoire que la PR ne peut pas contourner**. C'est la même bascule que ESLint, TypeScript ou les tests : tant que c'est optionnel, l'adoption plafonne.

**Effort réel** : faible. Tu as déjà `pre_commit_check`, `mem_verify`, `haive memory verify`, et un package `github-action`. Il manque juste le pont : un workflow réutilisable qui invoque ces checks et bloque sur sortie non-zero.

---

### 6. Observabilité runtime cross-repo

**Problème** : tu peux mesurer combien de mémoires existent, mais pas **combien sont vraiment utiles**. Sans signal d'usage runtime, impossible de distinguer une mémoire qui sauve 10 dev/jour d'une mémoire fantôme jamais lue.

**Ce qui manque** :
- Agrégation du `runtime_journal` (déjà présent localement) vers le hub central
- Métriques par mémoire : appels, latence MCP, ratio de rejet par l'IA consommatrice
- Top-N mémoires consommées par équipe / par module / par client IA (Claude Code vs Cursor vs Copilot)
- Heatmap "fichiers les plus consultés via `mem_for_files`"

**Pourquoi c'est critique** : sans cette boucle, la curation IA auto (gap #7) est aveugle, et le ROI (gap #2) est hypothétique. Avec, hAIve peut prouver chaque mois quelles équipes profitent vraiment de la mémoire — et lesquelles ont besoin d'aide.

**Effort réel** : moyen. Le `runtime_journal` existe déjà. Il faut un endpoint d'ingestion côté serveur central + un schéma OpenTelemetry-compatible pour brancher sur Datadog/Grafana sans recoder.

---

### 7. RBAC et gouvernance

**Problème** : aujourd'hui aucun contrôle d'accès. C'est un blocant dur pour les orgs avec des équipes
sécurité et compliance.

**Ce qui manque** :
- Qui peut promouvoir `personal → team` ? `team → org` ?
- Qui peut écrire dans `org/` ?
- Qui peut lire les mémoires du module `paiements` vs `RH` ?
- Audit log des promotions et suppressions

---

## Tableau de synthèse (révisé 2026-05-06)

| # | Gap | Effort | Impact | Pourquoi critique |
|---|---|---|---|---|
| 1 | Promouvoir `hub` → scope `org/` first-class | M | 🔴 Bloquant | Sans ça, pas d'org-level tool. 30% du chemin est déjà fait (`haive hub`). |
| 2 | Memory-as-code CI gate (PR bloque si mémoire critique non updated) | S | 🔴 Crée la dépendance | Bascule "outil sympa" → "infrastructure obligatoire". Réutilise `pre_commit_check` + package `github-action`. |
| 3 | Serveur central optionnel + analytics ROI (heures éco, leaderboard, santé) | L | 🔴 Buy-in direction | ROI invisible = pas de signature CTO. Framing produit, pas juste technique. |
| 4 | Observabilité runtime cross-repo (agrégation `runtime_journal`) | M | 🟠 Mesure la valeur | Distingue mémoires utiles vs fantômes. Pré-requis à la curation IA. |
| 5 | Slack digest + GitHub PR comment (mémoires pertinentes au diff) | M | 🟠 Adoption non-dev | Tech leads / managers entrent dans la boucle sans CLI. |
| 6 | RBAC + audit log (qui promeut, qui supprime) | M | 🟠 Compliance | Blocant pour orgs avec sécurité / RGPD / SOC2. |
| 7 | Curation IA cross-équipes (dédup, auto-deprecation, escalade) | L | 🟡 Scale only | N'a de sens qu'à 50+ équipes / 1000+ mémoires. **Ne pas surinvestir trop tôt**. |
| 8 | Migrations de mémoire (versioning du schema, scripts v0.X→v1) | S | 🟡 Avant v1.0 | Évite la dette de schéma quand le format évolue. |
| 9 | Benchmarks publics vs Engram (token budget, latence, qualité briefing) | S | 🟡 Crédibilité | Argument commercial face au concurrent Go (2 821★). |

---

## Ordre d'attaque recommandé (révisé)

**Phase A — quick wins qui débloquent tout** :
1. Promouvoir `hub` → scope `org/` first-class (S/M, fondation)
2. Memory-as-code CI gate (S, transforme l'usage en infrastructure)

Ces deux items sont peu coûteux et changent la nature du produit.

**Phase B — buy-in direction** :
3. Serveur central optionnel + analytics ROI
4. Observabilité runtime cross-repo (agrégation `runtime_journal`)

Sans ces deux-là, impossible de prouver la valeur au COMEX.

**Phase C — adoption non-dev** :
5. Slack digest + GitHub PR comments

Points d'entrée visibles par les managers et tech leads.

**Phase D — compliance** :
6. RBAC + audit log

Blocant pour les orgs régulées (banque, santé, public).

**Phase E — scale (à faire seulement quand nécessaire)** :
7. Curation IA auto cross-équipes
8. Migrations de mémoire (avant v1.0)
9. Benchmarks publics vs Engram

⚠ **Ne pas attaquer la phase E trop tôt** : la curation IA est un produit en soi. Tant que la base ne dépasse pas 1000 mémoires actives, la review humaine + heuristiques actuelles suffisent.

---

## Ce que hAIve a déjà (avantages à conserver)

- Architecture git-natif → zéro infra pour démarrer, offline, self-hostable, audit gratuit via git history
- MCP agnostique → fonctionne avec Claude Code, Cursor, Continue, Copilot (via bridge)
- Ancrage commit SHA → staleness automatique, source de vérité = code mergé
- Scoping team/module → filtrage de pertinence natif, pas de bruit cross-domaine
- session_recap → continuité de contexte inter-session sans effort

Ces forces sont exactement ce qu'Engram n'a pas. L'enjeu est de les préserver en ajoutant les couches enterprise.

---

## Récap exécutif (révision 2026-05-06)

**Diagnostic principal** : hAIve a la bonne fondation. Le passage à l'enterprise n'est pas une refonte, c'est l'empilement de 6-9 couches dont 2 sont des quick wins déjà à 30% faits.

**3 angles morts corrigés dans cette révision** :
1. **`haive hub` existe déjà** → le gap #1 n'est pas "tout construire", c'est promouvoir un proto existant en scope `org/` first-class.
2. **Memory-as-code CI gate** → quick win sous-estimé qui transforme hAIve en infrastructure obligatoire (vs outil optionnel). Réutilise des composants déjà présents.
3. **Observabilité runtime cross-repo** → le `runtime_journal` existe déjà localement ; l'agréger côté hub débloque à la fois le ROI et la curation IA future.

**Reframing du gap #2 (analytics)** : sans framing financier (heures économisées, leaderboard équipes, alertes santé, rapport mensuel COMEX), un dashboard reste une promesse vide aux yeux d'un CTO.

**Garde-fou stratégique** : ne pas surinvestir trop tôt sur la curation IA cross-équipes. C'est un produit en soi qui n'a de sens qu'à l'échelle (>50 équipes, >1000 mémoires). En dessous, les heuristiques actuelles + review humaine légère suffisent.

**Ordre d'attaque condensé** :
> A. `hub→org` + CI gate (quick wins) → B. serveur central + observabilité runtime (ROI) → C. Slack/GitHub PR (adoption) → D. RBAC (compliance) → E. curation IA + migrations + benchmarks (scale).
