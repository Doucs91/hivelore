---
id: 2026-07-05-convention-hivelore-workspace-dependencies
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/embeddings/package.json
    - packages/mcp/package.json
    - packages/cli/package.json
  symbols: []
sensor:
  kind: regex
  pattern: '"@hivelore\/[^\"]+"\s*:\s*"\^[0-9]+\.[0-9]+\.[0-9]+"'
  paths:
    - packages/embeddings/package.json
    - packages/mcp/package.json
    - packages/cli/package.json
  message: 'Use workspace:* for cross-package @hivelore dependencies.'
  severity: warn
  autogen: false
  last_fired: null
tags:
  - packaging
  - workspace
created_at: '2026-07-05T00:00:00.000Z'
expires_when: null
verified_at: '2026-07-05T00:00:00.000Z'
stale_reason: null
related_ids:
  - 2026-05-02-attempt-crosspackage-deps-with-xyz-ranges
last_read_at: null
revision_count: 0
---

# Use workspace dependencies for Hivelore packages

Internal `@hivelore/*` dependencies must use `workspace:*`; semver ranges can silently resolve published packages instead of the local workspace.
