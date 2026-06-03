# LOT B — Valeur visible & preuve (`feature/visible-value`)

> **Priorités battle plan : P1 (moat visible) + P4 (anti-faux-positifs) + P5 (preuve chiffrée).**
> Lis d'abord `docs/HAIVE_COMPETITIVE_IMPLEMENTATION_PLAN.md` (règles anti-conflit) et le battle plan
> §8 (moat) + §9 (claims).

---

## Mission

Le moat de hAIve — **l'enforcement mesuré** — existe déjà dans le code mais est dilué dans des
sous-commandes. Rends-le **lisible en 10 secondes** : la scène « agent s'apprête à répéter une faute →
bloqué → compteur de prévention ++ », plus un **chiffre publiable** que personne d'autre ne peut montrer.

## Pourquoi ça bat la concurrence

- **Engram & memory banks** : « retrieve and surface » — ils ne *bloquent* pas et ne *mesurent* pas.
  Le « caught-for-you » + la trend de prévention sont le « aha » qu'ils ne peuvent pas reproduire (§8).
- **Tout le marché** : « comment je sais que ça aide ? » — `eval` (recall/MRR/catch-rate + baseline)
  répond par un chiffre. C'est l'argument différenciant le plus sous-exploité (§5 réel-needs, §8).

## Ce qui existe déjà (NE PAS réécrire — restituer/durcir)

Vérifié dans le code :
- `core/prevention.ts` — log append-only `.jsonl` (1 event par catch, source `sensor`|`anti-pattern`),
  `computePreventionTrend()`, `computeRecurrence()`. **Moteur prêt.**
- `core/impact.ts` — `computeImpact()` pure : sépare *read* ≠ *applied* ≠ *prevented*, tier + prune flag.
  Les reads sont cappés (un read = « surfacé », pas « utile »). **Moteur prêt.**
- `core/dashboard.ts` — `dashboard.ts` agrège impact + prevention + gate-precision + decay en un
  snapshot déterministe (pure, sans I/O). **Base prête, à réordonner.**
- `core/gate-precision.ts` — `computeGatePrecision()`. **Prêt à câbler en CI.**
- `core/eval.ts` — `recall`, `mrr` (`1/best_rank`), `catch_rate`, `overallScore()`, `buildReport()`,
  `compareEvalReports()` (baseline/courant). `core/eval-history.ts` pour le trend. **Moteur prêt.**
- `scripts/agent-roi-benchmark.mjs` — base de benchmark ROI (cf. `pnpm benchmark:roi`).
- `cli/commands/session-end.ts`, `dashboard.ts`, `eval.ts`, `benchmark.ts`, `bench.ts`.

## Fichiers possédés par ce lot

```
packages/core/src/prevention.ts
packages/core/src/impact.ts
packages/core/src/dashboard.ts
packages/core/src/gate-precision.ts
packages/core/src/eval.ts
packages/core/src/eval-history.ts
packages/cli/src/commands/dashboard.ts
packages/cli/src/commands/session-end.ts
packages/cli/src/commands/eval.ts
packages/cli/src/commands/benchmark.ts
packages/cli/src/commands/bench.ts
packages/cli/src/commands/stats.ts
scripts/agent-roi-benchmark.mjs   (+ nouveaux scripts bench)
```

Glue partagée (append-only, §2.2) : `cli/src/index.ts`, `mcp/src/server.ts` si tu ajoutes une commande/tool.

## Tâches (checklist)

- [ ] **B1 — Résumé « caught-for-you » de fin de session.** Dans `session-end` (et/ou un nouveau tool
  MCP `mem_session_end` côté résumé), produire un bloc lisible : *« Tu allais répéter X (leçon Y) →
  bloqué. Prevention count: 7 → 8. »* Source = `prevention.ts` events de la session. C'est LA scène
  de démo du §8.
- [ ] **B2 — Trend de prévention en tête du dashboard.** Réordonner `dashboard.ts` pour mettre le
  compteur de prévention + la récurrence **en premier** (la ligne qu'un humain lit en 5 s), pas enfouis.
  Ajouter une sortie `--json` propre pour CI/scripts.
- [ ] **B3 — `briefingProofLine()` (point de coordination Lot C).** Exposer dans `core` une fonction
  **pure** `briefingProofLine(events, opts): string | null` qui retourne *« ce harnais t'a évité N
  répétitions ce mois-ci »* (ou `null` si pas d'events). **Tu ne câbles PAS dans `get-briefing.ts`** —
  c'est le Lot C qui l'importe. Documente la signature finale dans la PR + ping le Lot C.
- [ ] **B4 — Eval-gate de précision en CI (P4).** `haive eval` doit pouvoir échouer (exit≠0) si le
  catch-rate des vrais positifs baisse OU si les faux positifs du gate montent (via `gate-precision`).
  Flag `--fail-under` existe déjà pour le score ; ajoute le volet précision-du-gate. But : un faux
  positif qui entraîne l'agent à ignorer le gate est un bug existentiel (§8.4).
- [ ] **B5 — Boucle de feedback sur les blocks (P4).** Quand un block est contesté par l'humain
  (`mem_feedback`), le sensor/anti-pattern correspondant est déprécié/affiné automatiquement. Logique
  pure dans `impact.ts`/`gate-precision.ts`, câblage CLI.
- [ ] **B6 — Chiffre de benchmark publiable (P5).** À partir de `agent-roi-benchmark.mjs`, produire un
  chiffre reproductible (« +X% de recall / N répétitions évitées sur ce corpus ») + un format de sortie
  exploitable pour un badge README. (Le badge lui-même = Lot C/README ou humain ; toi tu fournis le
  chiffre + le script.)
- [ ] **B7 — Tests.** Toute la logique ajoutée est pure → tests core (`prevention`, `impact`,
  `dashboard`, `gate-precision`, `eval`).

## Livrable démontrable

```bash
haive dashboard            # 1re ligne = "Prévention: 23 catches (30j), 2 récurrences à revoir"
haive session-end          # "Bloqué: réintroduction de legacyField (RGPD #legal-x). Prevention 7->8"
haive eval --fail-under 80 # échoue si recall/catch-rate régressent OU faux positifs du gate montent
```

## Definition of Done

- B1→B7 faits, `pnpm -r build && typecheck && test` verts, nouveaux tests core.
- `briefingProofLine()` exporté depuis `core` avec signature documentée pour le Lot C.
- PR `feature/visible-value` → `develop` ouverte avec captures de la sortie console.

## Points de coordination

- **NE touche PAS `get-briefing.ts`** (Lot C). Expose `briefingProofLine()` et laisse le Lot C câbler.
- NE touche PAS `init*.ts`/`seed-git.ts`/`findings.ts` (Lot A) ni `sync.ts`/`code-map.ts` (Lot C).
