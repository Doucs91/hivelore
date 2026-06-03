# LOT A — Onboarding & Cold-start (`feature/cold-start`)

> **Priorité battle plan : P0 — le plus haut levier.** Tue le risque mortel §7.1 (la valeur invisible
> en session #1). Lis d'abord `docs/HAIVE_COMPETITIVE_IMPLEMENTATION_PLAN.md` (règles anti-conflit) et
> `docs/HAIVE_BATTLE_PLAN_COMPETITIVE_POSITIONING.md` §8.1.

---

## Mission

Aujourd'hui `haive init` produit un `.ai/` quasi vide : hAIve « vaut ~zéro tant que le corpus n'est pas
nourri ». À la fin de ce lot, **`haive init` finit avec un corpus non-trivial (10-30 mémoires + sensors
actifs) et un rapport lisible**, sans qu'aucune mémoire n'ait été écrite à la main.

## Pourquoi ça bat la concurrence

- **Engram** : 0 bootstrap structuré, 0 seeding depuis l'historique. On démarre avec un cerveau déjà
  rempli **de leçons spécifiques au repo**.
- **memory banks / memories.sh** : injectent du markdown vide à remplir à la main. Nous, on **dérive**
  les leçons des reverts/hotfix git et des findings CI — du contenu que l'équipe a déjà payé.

## Ce qui existe déjà (NE PAS réécrire — orchestrer)

Vérifié dans le code :
- `core/seed-git.ts` — `proposeSeedsFromCommits()` détecte `revert`/`fixup`/`hotfix`/`urgent fix` et
  produit des `SeedProposal` (slug, what, why, kind). **Moteur prêt.**
- `core/findings.ts` — `parseSarif()` / `parseSonar()` → `Finding[]` → `draftsFromFindings()` →
  `filterNewDrafts()` (dédup par topic). **Moteur prêt.**
- `cli/commands/init-stack-packs.ts` — packs curés (mémoires + sensors regex) pour 20 stacks :
  nestjs, nextjs, remix, react, express, fastify, prisma, drizzle, zustand, redux, reactquery, trpc,
  mongoose, graphql, fastapi, django, go, flask, vue, spring. **Contenu prêt.**
- `cli/commands/init.ts` — `registerInit()` (ligne ~245), `resolveStacksToSeed()` (~511). Point d'entrée.
- `cli/commands/welcome.ts` — `haive welcome` imprime les mémoires en ordre de lecture. **Base de resti-
  tution prête.**
- `cli/commands/ingest.ts` + `memory-import-changelog.ts` — ingestion findings / changelog.

## Fichiers possédés par ce lot

```
packages/cli/src/commands/init.ts
packages/cli/src/commands/init-stack-packs.ts
packages/cli/src/commands/init-bootstrap.ts
packages/cli/src/commands/init-mcp-setup.ts
packages/cli/src/commands/welcome.ts
packages/cli/src/commands/ingest.ts
packages/cli/src/commands/memory-seed.ts
packages/cli/src/commands/memory-seed-git.ts
packages/core/src/seed-git.ts
packages/core/src/findings.ts
packages/core/src/seed.ts
```

Glue partagée (append-only, voir plan §2.2) : `cli/src/index.ts` si tu ajoutes une commande.

## Tâches (checklist)

- [ ] **A1 — Détection automatique du stack.** Mapper `package.json` / `requirements.txt` / `go.mod` /
  `pom.xml` → la liste de stacks de `init-stack-packs.ts`. Une fonction pure
  `detectStacks(rootFiles): StackName[]` (testable). Aujourd'hui les stacks sont sélectionnés
  manuellement ; rends-le automatique.
- [ ] **A2 — `haive init` orchestré « one-shot ».** À l'init (avec un flag `--seed` activé par défaut,
  `--no-seed` pour désactiver) : (1) détecte le stack → charge les packs, (2) lance `seed-git` sur les
  N derniers reverts/hotfix (défaut N=50 commits), (3) écrit tout en `draft`/`proposed`. Idempotent
  (re-run ne duplique pas — réutilise la dédup par topic/slug existante).
- [ ] **A3 — Rapport de première session.** À la fin de `init` (et comme bloc dans `haive welcome`),
  imprime un encadré actionnable : nombre de reverts trouvés (+ récurrents), packs chargés (+ nb de
  sensors actifs), findings critiques repérés, total de leçons prêtes. Doit donner envie. Format
  texte propre via `utils/ui`.
- [ ] **A4 — `haive ingest` prêt pour la CI dès J1.** Vérifie/complète le parse Sonar/ESLint (SARIF)
  → drafts, avec un exit code propre et un mode `--dry-run`. Documente l'usage CI (1 bloc README ou
  commentaire d'en-tête).
- [ ] **A5 — Tests.** `detectStacks`, l'orchestration de seeding (avec un repo git de fixture), le
  rendu du rapport. Le core reste en fonctions pures testables.

## Livrable démontrable

```bash
cd un-repo-vierge
haive init            # détecte NestJS, seed 4 reverts (2 récurrents), charge 6 sensors, 3 findings
# => "14 leçons prêtes, 6 sensors actifs" en < 2 min, 0 mémoire écrite à la main
```

## Definition of Done

- A1→A5 faits, `pnpm -r build && typecheck && test` verts, nouveaux tests pour la logique pure.
- `init` est idempotent (re-run sans doublon).
- PR `feature/cold-start` → `develop` ouverte avec démo dans la description.

## Points de coordination

- Si `init` doit appeler le générateur de bridges du **Lot C**, attends que le Lot C expose
  `generateBridges(...)`. En attendant, garde les bridges actuels. Ne touche **pas** `sync.ts` ni
  `get-briefing.ts` (Lot C), ni `dashboard.ts`/`prevention.ts` (Lot B).
