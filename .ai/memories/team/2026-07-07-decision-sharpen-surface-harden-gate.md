---
id: 2026-07-07-decision-sharpen-surface-harden-gate
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/doctor.ts
    - packages/cli/src/commands/release.ts
    - packages/core/src/config.ts
  symbols: []
tags:
  - de-gras
  - fail-open
  - review-noise
  - doctor
  - release-ship
  - v0.50.0
created_at: '2026-07-07T05:38:05.182Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Decision Sharpen Surface Harden Gate

**What (v0.50.0):** sharpen the surface + harden the one fail-open, concentrating on the gate.

1. **Fail-open hardened** (`runSensorGate` catch): a `sensor-gate-errored` (the sensor machinery threw, so NO sensors evaluated — the one way the deterministic layer silently dies) now FAILS THE BUILD in CI (severity error, impact 60) instead of a quiet warn. Locally it stays non-blocking but is a loud, high-impact finding (impact 25, ⛔ message). A green CI that evaluated no sensors is a lie about protection.
2. **Fuzzy review matches OFF by default** (`anti-pattern-review`): new config `enforcement.reviewMatches` (default false). Across real sessions the aggregated "N lessons plausibly match — review" finding fired on nearly every commit and was skimmed past — noise that trains people to ignore the gate. Only a deterministic sensor block is signal. Restore with `reviewMatches:true` or `antiPatternGate:"review"`.
3. **doctor info floor**: info findings are hidden by default (with a "N informational finding(s) hidden — --all to show" summary line); `--all` restores them. Warn/error always show; the coverage metrics (`behaviour-coverage`, `harness-coverage`) carry `alwaysShow:true` so the measure stays visible. New `Finding.alwaysShow`.
4. **`hivelore release ship`**: one command = `git pull --rebase` → tag+push (shared `createAndPushTag`, refactored out of `release tag`) → poll CI via the real `enforce finish --wait` (spawned, live output). Collapses the 3-command release dance.

**Deliberately deferred (breaking / 1.0 — NOT shipped silently):** full `haive` compat removal (breaks existing installs + generated `haive-*.yml` workflows), memory-type schema collapse (rewrites/breaks existing corpora), flipping the embeddings default (regresses retrieval + eval baselines), redundant-capture-surface redesign, usage-driven MCP tool prune, eval-can't-score-100 redesign. These need an explicit GO + a migration/deprecation cycle. Builds on [[2026-07-06-decision-de-ceremony-pass]].
