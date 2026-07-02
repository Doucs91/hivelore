---
id: 2026-06-05-convention-briefing-breadcrumbs-are-pointers-not-copies
scope: team
type: convention
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/get-briefing.ts
    - packages/cli/src/commands/briefing.ts
  symbols: []
tags:
  - briefing
  - breadcrumbs
  - token-budget
  - context-efficiency
created_at: '2026-06-05T22:47:25.662Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.990Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
## Breadcrumbs `start_here` must stay a pointer map, never a copy of payload that already ships

When building `breadcrumbs.start_here` in `get_briefing` (and the `Start here:` block in `haive briefing`), emit a **terse pointer only**: `priority · id · scope/type · anchor`. Do NOT re-summarize the memory body — the body already ships in `memories[]` (and is one `mem_get` away). The 0.26.3 breadcrumbs-first feature regressed here by calling `compactSummary(memory.body)` into `start_here`, so the top memories appeared twice and the *default* payload grew, which is the opposite of the "keep default context small / map, not manual" goal it was meant to serve. Fixed in v0.26.4.

**Why:** the OpenAI/Fowler breadcrumbs principle is "small default context, pull depth on demand" — a breadcrumb says *where/why to look*, the memory says *what's in it*. Duplicating the second into the first defeats the feature.

**How to apply:**
- breadcrumbs = ordered triage list (priority + id + anchor). Reasons/why live on the memory record, bodies behind `mem_get`.
- Any derived/auxiliary section added to a briefing must be **counted in the token budget**: `get_briefing` had `totalTokens` computed (line ~566) *before* breadcrumbs were built (~788), so `estimated_tokens` understated the wire size. v0.26.4 adds `breadcrumbTokens` into `estimated_tokens` and reports `budget.spent.breadcrumbs`. Keep the invariant `estimated_tokens >= project + modules + memories`.
- Tests lock this in: MCP asserts `start_here` does not contain body text and `budget.spent.breadcrumbs > 0`; CLI asserts the `Start here` block does not duplicate the body.

Related: [[2026-06-01-decision-harness-engineering-positioning-reconciliation]].
