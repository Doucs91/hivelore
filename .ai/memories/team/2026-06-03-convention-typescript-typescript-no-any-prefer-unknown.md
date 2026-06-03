---
id: 2026-06-03-convention-typescript-typescript-no-any-prefer-unknown
scope: team
type: convention
status: validated
anchor:
  paths: []
  symbols: []
sensor:
  kind: regex
  pattern: ':\s*any\b'
  paths: []
  message: >-
    Explicit `any` disables type-checking — use `unknown` + narrowing or a
    precise type.
  severity: warn
  autogen: false
  last_fired: null
tags:
  - typescript
  - types
  - stack-pack
created_at: '2026-06-03T22:53:19.995Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Convention Typescript Typescript No Any Prefer Unknown

Avoid `any` — it disables type-checking for everything it touches and spreads silently. Use `unknown` and narrow, or a precise type.

Enable `"strict": true` (and `noImplicitAny`) in tsconfig. `unknown` forces a check before use; `any` forces nothing.

> _Seeded by `haive init` from the **typescript** stack pack — generic guidance, not repo-specific. Anchor it to a real file or replace it with a repo-specific note to raise it above background priority._
