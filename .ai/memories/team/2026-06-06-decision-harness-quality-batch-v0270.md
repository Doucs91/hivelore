---
id: 2026-06-06-decision-harness-quality-batch-v0270
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/sensor-suggest.ts
    - packages/core/src/sensors.ts
    - packages/cli/src/commands/eval.ts
    - packages/mcp/src/tools/get-briefing.ts
  symbols: []
tags:
  - sensors
  - eval
  - briefing
  - quality
  - honesty
created_at: '2026-06-06T03:51:57.818Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.992Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
## Harness-quality batch (v0.27.0) — sensor trust, eval honesty, version-aware briefings

Grounded in dogfooding hAIve across tasks. Four changes:

1. **Sensor brittleness lint** — `sensorPatternBrittleness(pattern)` in core/sensors.ts flags patterns
   over-fit to line numbers/ranges (`1131-1186`). High-precision: digits inside `[...]`/`{...}`
   generalize and are NOT flagged (so `v[0-9]+\.[0-9]+`, `:\s*any\b` stay clean). Surfaced in
   `sensors list` (⚠ + count) and blocks brittle `block` promotion without `--force`.
2. **Generator hardening** (sensor-suggest.ts): error/diagnostic stopwords (`unknown`/`exception`/
   `fallback`/…) + reject multi-word prose/error fragments (`/\S\s+\S+\s+\S/`, `/[A-Za-z]:\s/`). This
   kills the residual dead-sensor class — sensors built from an incident's ERROR OUTPUT (e.g. a
   backtick span `CACError: Unknown option …`) that never match a real source diff. (Line-number/
   file-ref rejection via `isDegenerateToken` already existed.)
3. **`server_version`** in get_briefing output (typeof-guarded `__HAIVE_VERSION__`, "dev" in tests) —
   the recurring "is the MCP I'm talking to the same as the repo code?" friction, now answerable in-band.
4. **eval authored-only score** (cli/commands/eval.ts): when a run blends authored (independent) +
   synthesized (self-referential) cases, surface the authored-only score separately so 100/100 isn't
   read as ground truth.

**Gotcha captured during this work:** the authored-only score must count **authored SENSOR cases**, not
just the retrieval slice. Synthesis only produces retrieval cases, so ALL sensor cases are authored.
The first cut sliced only retrieval and reported authored=0/100 on this repo (whose 8 authored cases are
all sensors) — misleading. Fixed: `overallScore(authoredRetrievalAgg, sensorAgg)`.

**Did NOT touch** the `uncaptured-failures` failure classifier (see [[2026-06-06-decision-search-perf-and-index-staleness]]): exploratory CLI errors flagged there are advisory-only and a legitimate signal class.

Related: [[2026-06-06-decision-code-search-hybrid-ranking]], [[2026-06-05-convention-briefing-breadcrumbs-are-pointers-not-copies]].
