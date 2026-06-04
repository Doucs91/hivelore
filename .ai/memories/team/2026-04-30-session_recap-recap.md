---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/findings.ts
    - packages/core/test/findings.test.ts
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-06-04T21:22:33.935Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 38
requires_human_approval: false
---
## Goal
Close the Sonar gap in the ingest quality floor: numeric Sonar rule keys (typescript:Sxxxx) weren't caught by the name-based stylistic denylist.

## Accomplished
- Shipped v0.26.1 (CI+sonar green; enforce finish 100%).
- core/findings.ts: isStylisticRule now also matches a curated set of Sonar formatting/naming/trivial keys (S100/S101/S103/S105/S113/S114-S122/S125/S1110/S1116/S1131/S1542) via sonarRuleKey() which normalizes leading zeros (S00117 -> S117). Real security/quality rules (S2068, S5852, S1234) untouched.
- Tests: Sonar key detection + draftsFromFindings drops Sonar stylistic, keeps security. core 341 / cli 69 green.
- LIVE-verified (user request): haive ingest --from sonar on 5 findings -> 3 stylistic filtered (S103/S00117/S1131), 2 kept (S2068 creds, S5852 ReDoS).

## Discoveries & surprises
- Sonar rule ids are language-prefixed numeric (typescript:S103) with two historical forms (S00117 legacy vs S117 modern) — normalize by stripping leading zeros before matching a denylist. Severity filter alone was the prior lever; a curated key set is more precise (keeps a BLOCKER security rule, drops a MINOR formatting rule, regardless of severity).
- Finding.tool/type/tags are not on the core Finding type, so tag-based ("convention"/"style") filtering wasn't available — a curated rule-key set was the pragmatic, dependency-free path.

## Files touched
- `packages/core/src/findings.ts`
- `packages/core/test/findings.test.ts`

## Next steps
If Finding ever carries Sonar tags/cleanCodeAttribute, prefer tag-based filtering (tags includes 'convention'/'style') over the hardcoded key set. Keep the Sonar key set conservative — only add a key when it's unambiguously formatting/naming.
