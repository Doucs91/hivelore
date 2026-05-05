# Plan — Adoption, ROI, tokens, et surface IDE (hAIve)

Ce document liste les chantiers dérivés des recommandations produit techniques (mémoire d’équipe, optimisation de contexte, adoption, friction, PR, IDE). Chaque livrable indique où il vit dans le monorepo.

## Objectifs utilisateur

| Objectif | Mécanisme |
|----------|-----------|
| Valeur vite | `welcome` liste les mémoires fondatrices ; hints renforcés après `get_briefing` |
| Moins de tokens | Presets briefing (`quick` / `balanced` / `deep`) ; format mémoires `actions` dans `get_briefing` |
| Qualité du corpus | `haive memory lint` ; similarité corps dans `mem_save` (warn) |
| Preuve ROI | `haive stats --export-report <fichier.json>` (agrégats + métriques outils) |
| Boucle équipe | Action GitHub : chemins d’ancre absents au checkout + checklist `haive memory verify` |
| Surface IDE | Vue hAIve déplacée vers la **barre d’activités** + doc d’installation / usage VS Code |

## Ordre d’implémentation (suivi)

1. **Core — presets et compression de corps**
   - Fichiers : `packages/core/src/briefing-preset.ts`, `packages/core/src/briefing-body.ts`
   - Export : `packages/core/src/index.ts`
   - Tests : `packages/core/test/briefing-preset.test.ts`, `briefing-body.test.ts`

2. **MCP — `get_briefing`**
   - Champ `budget_preset?: quick | balanced | deep` (substitue `max_tokens` / `max_memories` selon tableau)
   - `format`: ajout `actions` (lignes type puces « actionnable » avant application du budget mémoires)
   - Hints additionnels orientés valeur / `welcome` ou `attempt`
   - Fichiers : `packages/mcp/src/tools/get-briefing.ts`, `packages/mcp/src/server.ts`

3. **MCP — `mem_save`**
   - Avertissement similarité texte (Jaccard grossier sur tokens) vs autres mémoires du même scope/type
   - Fichier : `packages/mcp/src/tools/mem-save.ts`

4. **CLI**
   - `haive briefing --budget quick|balanced|deep` — `packages/cli/src/commands/briefing.ts`
   - `haive welcome` — nouveau `packages/cli/src/commands/welcome.ts` + registre dans `index.ts`
   - `haive memory lint` — nouveau `packages/cli/src/commands/memory-lint.ts`
   - `haive stats --export-report <path>` — `packages/cli/src/commands/stats.ts`

5. **GitHub Action**
   - Liste des mémoires dont un chemin d’ancre correspond au fichier modifié **et** le fichier n’existe plus dans le workspace
   - Footer : rappel `haive memory verify`
   - Fichier : `packages/github-action/src/run.ts`

6. **VS Code (`packages/vscode`)**
   - Nouveau container de vues dans la barre d’activités (icône dédiée) → la vue « hAIve Memories » n’est plus noyée dans l’Explorer
   - Document : cette section ci-dessous + mise à jour `package.json` `contributes`
   - Fichiers : `package.json`, éventuelle note dans `packages/vscode/README.md` si présent

## Presets briefing (valeurs livrées)

| Preset | `max_tokens` | `max_memories` | `include_module_contexts` |
|--------|--------------|----------------|---------------------------|
| `quick` | 2500 | 5 | `false` |
| `balanced` | 8000 | 8 | `true` (défaut historique) |
| `deep` | 16000 | 14 | `true` |

`balanced` reflète les défauts actuels de `get_briefing` avant personnalisation.

## Surface visible dans VS Code — ce qui est prévu pour toi

- **Icône hAIve** dans la barre latérale gauche (activity bar), à côté de l’explorer / Git.
- Ouverture de la liste des mémoires (existant), filtre « fichier courant », CodeLens et status bar conservés.
- **Installation** : ouvrir le dossier racine où `.ai/memories/` existe ; le pack se nomme **`haive-vscode`** sous `packages/vscode/` — paquet avec `pnpm --filter haive-vscode run package` puis *Install from VSIX* dans Cursor/VS Code, ou publication marketplace plus tard.

## Hors périmètre volontaire (trop large pour ce lot)

- Webview tableau de bord complet (graphiques temps réel).
- Lint LLM-as-judge des mémoires.
- Cross-repo complet au-delà de `crossRepoSources` / `hub` déjà prévus dans la config.
- Middleware cloud de gouvernance signée.

Ces axes restent évolutifs et peuvent s’accrocher après validation du flux PR + preset + rapport stats.

## Implémenté (référence code)

| Chantier | Fichiers / commandes principales |
|---------|----------------------------------|
| Presets + format `actions` | `packages/mcp/src/tools/get-briefing.ts`, `packages/core/src/briefing-preset.ts`, `packages/core/src/briefing-body.ts` |
| Parité CLI | `haive briefing --budget`, `--memory-format`; `packages/cli/src/commands/briefing.ts` |
| Onboarding | `haive welcome` |
| Lint corpus | `haive memory lint` |
| Export ROI locale | `haive stats --export-report` |
| Action GitHub | `packages/github-action/src/run.ts` (ancres YAML + ancres cassées + footer) |
| IDE | Vue activity bar dans `packages/vscode/package.json` + README |
