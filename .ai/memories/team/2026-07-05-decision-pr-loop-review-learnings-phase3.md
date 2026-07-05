---
id: 2026-07-05-decision-pr-loop-review-learnings-phase3
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/pr-review-ingest.ts
    - packages/cli/src/commands/ingest.ts
    - packages/github-action/src/run.ts
  symbols: []
tags:
  - pr-loop
  - ingest
  - review-learning
  - excellence-plan
  - v0.42.0
created_at: '2026-07-05T02:48:59.194Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Phase 3 (excellence plan) — PR review learnings: the non-obvious choices

1. **The instruction filter is deliberately conservative and deterministic** (imperative-shape regex + explicit `/hivelore remember` marker, bots dropped, <12 chars dropped) — a question or "LGTM" must never become corpus. When the filter misses a real instruction, the marker is the escape hatch; do NOT loosen the shape regex to chase recall.
2. **One draft per thread, latest instruction wins** — replies supersede the chatter above them (GitHub returns comments ascending by id). Dedup across runs rides the EXISTING `ingest:<key>` topic mechanism with key `github-pr:<thread_id>`; never invent a parallel dedup store.
3. **The GitHub Action only ACKS, never commits.** Persisting stays `hivelore ingest --from github-pr <n>` run locally — a deliberate, reviewable step. Rationale: an action pushing to the branch needs write perms and fights branch protection; and corpus writes should always pass through the same local gate as any other change.
4. **Review learnings are type=convention, tag `review-learning`, status proposed** — they ride the normal classifier (real anchors → must_read on file edit, verified by test) with no special-case ranking. The differentiating step vs CodeRabbit is documented in the draft body itself: "consider sensors propose".
5. `--from github-pr` accepts a file path OR a PR number/URL — the file form keeps tests offline and CI-friendly (fixture payloads), the gh form is the live path. gh supplies auth + pagination; its absence yields a clear actionable error, never a crash.
