# LOT C — Reach & feedforward (`feature/reach`)

> **Priorités battle plan : P2 (reach au-delà de MCP) + P3 (feedforward durci).**
> Lis d'abord `docs/HAIVE_COMPETITIVE_IMPLEMENTATION_PLAN.md` (règles anti-conflit) et le battle plan
> §8.2 (widen reach) + §6-A (feedforward « competitive, not dominant »).

---

## Mission

Deux choses : (1) **sortir du MCP-only** en générant des bridges natifs pour les agents non-MCP, depuis
le même corpus `.ai/`, **avec les sensors `block` dedans** (là où memories.sh ne fait qu'injecter). (2)
Rendre le feedforward **indéniablement meilleur** qu'un AGENTS.md statique : **code-map actif dans
`get_briefing`** (zéro grep pour localiser un symbole).

## Pourquoi ça bat la concurrence

- **memories.sh** gagne sur le reach (« one memory store, every coding agent », 20+ configs) mais
  « it retrieves and surfaces — it doesn't block or enforce ». On atteint la **même parité de reach**,
  mais nos bridges **mordent** (sensors block + hook git exportés) → colonne « + enforcement » que
  personne d'autre n'a.
- **AGENTS.md statiques** : injectent et s'arrêtent. Notre briefing répond « où est X » sans grep, sous
  budget tokens, avec disclosure progressive.

## Ce qui existe déjà (NE PAS réécrire — étendre)

Vérifié dans le code :
- `cli/commands/sync.ts` — `haive sync --inject-bridge` injecte les top mémoires validées entre
  marqueurs `<!-- haive:memories-start/end -->` dans **CLAUDE.md + AGENTS.md** (ligne ~272-279).
  **Base d'injection prête — à étendre à d'autres cibles.**
- `init.ts` génère déjà CLAUDE.md / `.cursorrules` / `.github/copilot-instructions.md` (fonctions
  `writeBridge`, `writeCursorHaiveRule`). **Modèle de génération prêt.**
- `haive sensors export --format grep` — export des sensors existant (réutilise-le pour les bridges).
- `core/code-map.ts` — parse multi-langages → index `fichier → exports`. `findSymbol`-like helpers
  (cf. `code-map.ts` ~467 filtrage par fichier/symbole). `mcp/tools/code-map.ts` expose `code_map`.
- `mcp/tools/get-briefing.ts` — `get_briefing` actuel (project + module + breadcrumbs + skills sous
  budget). **C'est ici qu'on branche le code-map ; PLAN.md §7.1 décrit déjà l'intention.**
- `core/briefing-body.ts`, `briefing-preset.ts`, `token-budget.ts` — assemblage + budget.

## Fichiers possédés par ce lot

```
packages/cli/src/commands/sync.ts
packages/cli/src/commands/install-hooks.ts   (si le hook doit aller dans les bridges)
packages/mcp/src/tools/get-briefing.ts
packages/mcp/src/tools/code-map.ts
packages/core/src/briefing-body.ts
packages/core/src/briefing-preset.ts
packages/core/src/code-map.ts
packages/core/src/token-budget.ts
packages/core/src/skill-activation.ts
+ NOUVEAUX fichiers : packages/core/src/bridges.ts (générateur), cli/commands/bridges.ts
```

Glue partagée (append-only, §2.2) : `cli/src/index.ts`, `mcp/src/server.ts`, `core/src/config.ts` si tu
ajoutes une commande/tool/champ de config.

## Tâches (checklist)

- [ ] **C1 — Générateur de bridges natifs (pure core).** Nouveau `core/bridges.ts` :
  `generateBridges(root, memories, sensors, opts)` qui produit les fichiers natifs pour : `.clinerules`
  (Cline), `.windsurfrules` (Windsurf), `.continue/` (Continue), Cody (`.sourcegraph`/instructions),
  Zed (`.rules`), `AGENTS.md` (Codex/standard), Copilot (déjà partiel). Une cible = un formatteur pur,
  testable. Réutilise le contenu de `sync.ts` (mémoires validées) + `sensors export`.
- [ ] **C2 — `haive bridges sync` (CLI).** Commande idempotente qui régénère tous les bridges détectés
  (présence du fichier/dossier cible → on le tient à jour), entre marqueurs pour ne pas écraser le
  contenu manuel. Option `--all` pour tout générer, `--only cline,windsurf`. Hook git optionnel.
- [ ] **C3 — Sensors `block` DANS les bridges.** Chaque bridge inclut une section « règles dures »
  dérivée des sensors `block` (via `sensors export`). C'est le différenciateur vs memories.sh : nos
  ponts ne font pas que surfacer, ils portent les garde-fous.
- [ ] **C4 — Code-map actif dans `get_briefing` (P3, PLAN.md §7.1).** `get_briefing` accepte
  `symbols?: string[]` ; si fourni, interroge `code-map.ts` et injecte les localisations sous un budget
  séparé. CLI : `haive briefing --symbols PaymentService,TenantFilter`. Objectif : zéro grep/find pour
  localiser un symbole.
- [ ] **C5 — Câbler `briefingProofLine()` du Lot B.** Quand le Lot B a exposé `briefingProofLine()`
  dans `core`, importe-la et ajoute sa sortie en fin de briefing (si non-null). **Coordonne la
  signature** via la PR du Lot B. Si elle n'est pas prête, laisse un TODO + un point d'insertion clair.
- [ ] **C6 — `generateBridges` appelable par `init` (coordination Lot A).** Expose la fonction pour
  que le Lot A puisse l'appeler à l'init. Toi tu ne touches pas `init.ts` ; tu fournis l'interface.
- [ ] **C7 — Tests.** Formatteurs de bridges (snapshot par cible), `get_briefing` avec `symbols`,
  budget tokens préservé.

## Livrable démontrable

```bash
haive bridges sync --all
# => génère .clinerules, .windsurfrules, .continue/, AGENTS.md... avec mémoires + sensors block
haive briefing --symbols PaymentService
# => localise PaymentService sans grep, sous budget tokens
```
README (tableau) : « marche avec Claude Code, Cursor, Cline, Windsurf, Copilot, Continue, Codex —
+ enforcement », parité de reach + colonne que personne d'autre n'a.

## Definition of Done

- C1→C7 faits, `pnpm -r build && typecheck && test` verts, snapshots des bridges.
- `generateBridges()` et `briefingProofLine()`-hook documentés pour les Lots A et B.
- PR `feature/reach` → `develop` ouverte avec exemples de bridges générés.

## Points de coordination

- **Tu possèdes `get-briefing.ts`.** Le Lot B te fournit `briefingProofLine()` — tu la câbles (C5).
- Expose `generateBridges()` pour le Lot A (C6) ; ne touche pas `init.ts` toi-même.
- NE touche PAS `dashboard.ts`/`prevention.ts`/`impact.ts` (Lot B) ni `seed-git.ts`/`findings.ts` (Lot A).
