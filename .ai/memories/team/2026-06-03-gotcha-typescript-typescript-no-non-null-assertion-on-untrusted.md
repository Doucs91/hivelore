---
id: 2026-06-03-gotcha-typescript-typescript-no-non-null-assertion-on-untrusted
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/core/src/types.ts
  symbols:
    - Anchor
tags:
  - typescript
  - types
  - safety
  - stack-pack
created_at: '2026-06-03T22:53:20.003Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Gotcha Typescript Typescript No Non Null Assertion On Untrusted

The non-null assertion (`value!`) silences the compiler but does NOT check at runtime — it just crashes later if the value is actually null/undefined.

Prefer a real guard (`if (!value) throw…`) or optional chaining. Reserve `!` for cases the compiler can't see but you can prove (e.g. just-initialized fields).

> _Seeded by `haive init` from the **typescript** stack pack — generic guidance, not repo-specific. Anchor it to a real file or replace it with a repo-specific note to raise it above background priority._
