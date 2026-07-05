---
id: 2026-07-05-gotcha-engram-is-a-nested-reference-repository
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - .ai/modules/engram/context.md
  symbols: []
sensor:
  kind: regex
  pattern: '(?:ENGRAM_API_KEY\s*=|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY)'
  flags: i
  paths:
    - engram/
  message: >-
    Do not commit Engram credentials or private keys in the nested reference
    checkout.
  severity: block
  autogen: false
  last_fired: null
tags:
  - engram
  - competitor
  - cross-repo
  - boundary
created_at: '2026-07-05T16:09:04.109Z'
expires_when: null
verified_at: '2026-07-05T16:49:08.451Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: 'competitor:engram-boundary'
revision_count: 0
requires_human_approval: false
validated_by: auto
---
## Gotcha

`engram/` is a nested Git checkout used as a read-only competitor/reference during Hivelore analysis. Treating it as part of the outer workspace can mix histories, vendor runtime data, or create an unauthorized cross-repo change. Do not add it as a workspace dependency or mutate it unless the developer explicitly scopes work to that repository.
