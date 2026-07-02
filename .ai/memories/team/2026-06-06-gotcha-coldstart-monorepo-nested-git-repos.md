---
id: 2026-06-06-gotcha-coldstart-monorepo-nested-git-repos
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/core/src/code-map.ts
    - packages/cli/src/commands/init.ts
    - packages/cli/src/commands/doctor.ts
  symbols: []
sensor:
  kind: regex
  pattern: 'code-map\s*:\s*["'']?discover["'']?'
  paths:
    - packages/core/src/code-map.ts
    - packages/cli/src/commands/init.ts
    - packages/cli/src/commands/doctor.ts
  message: >-
    Cold-start blind spot: monorepos with NESTED git repos (found dogfooding
    sandaga, v0.28.0)
  severity: warn
  autogen: true
  last_fired: null
tags:
  - cold-start
  - code-map
  - monorepo
  - nested-git
  - stack-detection
created_at: '2026-06-06T06:10:07.348Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.293Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
## Cold-start blind spot: monorepos with NESTED git repos (found dogfooding sandaga, v0.28.0)

Dogfooded hAIve cold-start on a real 1.4GB marketplace monorepo. The repo nests its app code in
**embedded git repos** (`sandaga/`, `sandaga_frontend/` each have their own `.git`), and commits
`node_modules` at the parent. Result before the fix: **`haive init` built a code-map of 2 of 1400+
files — silently.** The whole code-context layer (code_map, code_search, symbol_locations,
harness-coverage) was empty and nothing warned.

**Root cause:** `collectSourceFiles` (code-map.ts) used the parent's `git ls-files`, which does NOT
descend into a subdir that is its own git repo, and only FS-walked when git failed entirely. So nested
source was invisible.

**Fixes (v0.28.0), all verified on the real repo (2 → 1232 files):**
- code-map: discover nested git repos (`findNestedGitRepos`) and `git ls-files` each — still tracked-
  only, each repo's `.gitignore` respected, NO untracked-junk fallback (preserves
  [[2026-05-28-decision-codemap-tracked-files-by-default]]).
- stack detection: `collectNestedPackageDeps` reads nested package.json (init.ts), so sub-package
  frameworks are detected (`react` → `react,reactquery,tailwind,vite,typescript`).
- doctor: `countSourceFilesOnDisk` + a `code-map-near-empty` finding (many files on disk, few indexed)
  — the silent case is now loud.

**Also shipped this batch:** `release.yml` (publish-on-tag, gated by `npm-publish` env + `NPM_TOKEN`,
graceful no-op without the secret — agents still never publish); brittle sensors can never hard-block
(downgraded to warn at match time even if promoted) + doctor brittle count.

**How to apply:** when testing cold-start, use a repo with NESTED git repos and committed node_modules —
the easy single-repo case hides this. Related: [[2026-06-06-decision-harness-quality-batch-v0270]].
