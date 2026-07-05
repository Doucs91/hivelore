---
id: 2026-07-02-decision-kill-rituals-pass-design-choices
scope: team
type: decision
status: deprecated
anchor:
  paths:
    - packages/cli/src/commands/release.ts
    - packages/mcp/src/tools/mem-tried.ts
    - packages/mcp/src/tools/get-briefing.ts
    - packages/core/src/sensors.ts
  symbols: []
tags:
  - dx
  - sensors
  - release
  - token-budget
  - fatigue
  - v0.31.0
created_at: '2026-07-02T17:16:34.975Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.999Z'
stale_reason: 'Historical surface-reduction decision; implementation is complete.'
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# v0.31.0 "kill the rituals" — non-obvious design choices

1. **One-shot mem_tried sensor delegates to proposeSensor unchanged** — same validation gates (HEAD baseline, brittle, bad-example), one call instead of two. A rejected sensor still saves the attempt (never lose the lesson because the guardrail draft was bad). CLI `memory tried` now calls the shared mem_tried handler instead of duplicating it.

2. **Seeded stack sensors pin `paths: ["**"]` explicitly** instead of `[]`: empty paths fall back to the MEMORY's anchor paths (sensorAppliesToPath), and seeds get anchored to one exemplar file — which silently shrank stack-wide rules to a single file. `**` requires the glob fix in the same release: sensorAppliesToPath was pure-prefix, so ALL glob-scoped sensors (nestjs `**/*.controller.ts` etc.) had never fired anywhere.

3. **Review-warning debounce is listing-only**: the `anti-pattern-review` finding still counts every match; only the id LISTING collapses repeats seen <24h into "+N shown recently" (runtime-local `.ai/.runtime/enforcement/review-seen.json`, best-effort, TTL-pruned). Rationale: hot files re-match their own historical gate memories forever; re-listing them trains humans to skim the whole channel. `hivelore precommit` remains the full view.

4. **Token diet only bites when the briefing has direct hits**: background memories become one-line pointers (`mem_get` away) ONLY if a must_read/useful exists; thin briefings keep full bodies because they are all the reader has. Field result: cold-start briefing ~3.7k → ~1.4k tokens.

5. **`release bump`/`release tag` are two verbs, not one**: the tag must point at the commit containing the bump, and the commit must pass the gate — auto-committing inside the tool would bypass the hook narrative. `release tag` refuses on dirty tree / broken lockstep / existing tag, and never uses `git push --tags`.

6. **The high-max-memories briefing ritual was cargo cult** — autoBrief (v0.20.1) already self-surfaces all relevant anchored policies at commit; the gotcha documenting the workaround carried a sensor that nagged obsolete advice on every diff mentioning "decision-coverage" (removed).
