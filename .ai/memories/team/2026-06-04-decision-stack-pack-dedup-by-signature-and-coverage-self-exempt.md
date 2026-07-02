---
id: 2026-06-04-decision-stack-pack-dedup-by-signature-and-coverage-self-exempt
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/commands/init-stack-packs.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags:
  - seeding
  - dedup
  - enforcement
  - decision-coverage
  - friction
  - idempotency
created_at: '2026-06-04T04:06:24.549Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.987Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
## Stack-pack seeding is idempotent by signature; decision-coverage exempts self-authored memories

Two friction fixes (v0.20.1), both grounded in real pain hit while dogfooding:

### 1. Stack-pack re-seed no longer duplicates (root cause)
`buildFrontmatter` stamps **today's date** into the id (`YYYY-MM-DD-type-slug`), and `seedStackPack`
deduped only via `existsSync(filePath)`. So any **cross-day re-seed** (or a slug-format change, e.g.
the v0.19→v0.20 `typescript-typescript-…` → `typescript-…` fix) produced a duplicate — observed as 2
NEAR_DUPLICATE TS memories after re-init. **Fix:** dedup by a stable signature
(`type-slug`, date-insensitive) OR `topic` (`stack-pack:<stack>:<slug>`), set on every seed. Verified:
`init --stack typescript` twice → stays at 2 memories, no dup. Lesson: **never dedup seeded/upserted
records by filename when the id contains a date — use a stable topic/signature.**

### 2. decision-coverage gate exempts memories you author in the same commit
The gate blocked commits when a policy memory anchored to a changed file wasn't in the latest briefing
marker — including a memory you are **creating in this very commit** (you cannot brief a memory that
doesn't exist yet). Hit twice; the documented workaround was a manual `briefing --files … --max-memories 60`.
**Fix:** `verifyDecisionCoverage` now treats a policy memory as covered when its own `.md` file is in the
staged changeset. Strictly loosens (never adds false blocks). See [[2026-06-02-gotcha-decision-coverage-gate-needs-high-max-memories]].

Both verified: 323 core + 67 cli tests green, tsc clean, lint back to 1 finding.
