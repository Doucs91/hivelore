---
id: 2026-07-03-attempt-relied-on-pnpm-r-build
scope: team
type: attempt
status: validated
anchor:
  paths:
    - .github/workflows/ci.yml
  symbols: []
tags:
  - release
  - typecheck
  - ci
created_at: '2026-07-03T13:56:36.827Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Relied on `pnpm -r build` (tsup) + full test suite as pre-push verification for v0.34.0

**Why it failed / do NOT use:** tsup transpiles without type-checking and vitest doesn't run tsc either, so `bridgeTargets: []` inferred as never[] sailed through build+684 tests locally and only failed in CI's `tsc --noEmit` — the v0.34.0 tag points at a red-CI commit and a patch release (0.34.1) was needed.

**Instead, use:** Run `pnpm -r typecheck` locally before committing a release (it's the exact CI step). Build success and test success do NOT imply type-check success in this repo.
