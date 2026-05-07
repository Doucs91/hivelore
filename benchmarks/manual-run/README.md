# Benchmark manuel Cursor — haive vs sans haive

Deux **fixtures identiques** (Vitest + Zod) : `fixtures/order-haive` (avec `.ai/` et mémoire équipe) et `fixtures/order-plain` (sans `.ai/`).

## Prérequis

- hAIve global (ex. `haive --version`) pour initialiser / vérifier le bras haive.
- `pnpm` installé.

## Préparation des fixtures (à chaque machine)

Dans **chaque** sous-dossier `fixtures/order-plain` et `fixtures/order-haive` — utiliser **npm** évite que pnpm remonte au monorepo parent :

```bash
cd fixtures/order-plain   # ou order-haive
rm -rf node_modules
npm install
npm test   # doit échouer (3 tests rouges sur la validation)
```

Si tu préfères pnpm : `pnpm install --ignore-workspace` (sinon `zod` n’est pas résolu pour Vitest).

## Tâche T1 (identique pour les deux bras)

**Objectif :** faire passer `pnpm test` en ne modifiant que `src/schemas.ts` (et seulement si besoin, imports dans ce fichier).

**Prompt canonique** (copier-coller tel quel) :

```text
Tu es dans un mini-projet TypeScript (Vitest + Zod). Fais passer toutes les suites :
npm install puis npm test.
Ne modifie que src/schemas.ts pour que CreateOrderInputSchema reflète les règles attendues par les tests.
Ne lis pas d’autres dépôts ni le web.
```

### Bras A — Avec haive

1. Ouvrir le dossier `benchmarks/manual-run/fixtures/order-haive` comme racine de la fenêtre Cursor (ou workspace dédié).
2. Activer le MCP **haive** ; au début de la tâche : `get_briefing` + lecture des mémoires équipe (ou `haive memory list` / fichiers `.ai/memories/...`).
3. Démarrer un chrono au premier envoi du prompt canonique.
4. Arrêter au premier `pnpm test` entièrement vert (ou au budget temps convenu).
5. Noter dans `RESULTS.md` : temps, erreurs terminal, estimation tokens (si l’UI/API les donne), itérations homme/agent.

### Bras B — Sans haive

1. **Nouvelle** fenêtre Cursor ou chat **sans** serveur MCP haive (et sans ouvrir les fichiers `.ai/` du dépôt parent).
2. Ouvrir uniquement `benchmarks/manual-run/fixtures/order-plain`.
3. Même prompt canonique, même procédure de mesure.

### Limites (honnêteté méthodo)

- Deux sessions différentes sont nécessaires pour limiter la **contamination** (souvenir du correctif). Le pilote ci-dessous a été fait par un seul agent en séquence : les temps « agent » sont indicatifs ; les comparaisons tirées du **même modèle** dans deux chats propres sont plus fiables.

## Fichiers utiles

- Mémoire « bonne » (bras haive uniquement) :  
  `fixtures/order-haive/.ai/memories/team/2026-05-05-convention-order-input-zod.md`
- Tests de vérité : `fixtures/*/test/order.test.ts`

Enregistrer les métriques dans `RESULTS.md` (modèle + date + branche).
