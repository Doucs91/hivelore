---
id: 2026-06-02-decision-atomic-release-commit-and-skip-ci-tip
scope: team
type: decision
status: validated
anchor:
  paths:
    - .github/workflows/ci.yml
  symbols: []
tags:
  - git
  - ci
  - release
  - workflow
  - skip-ci
created_at: '2026-06-02T01:01:14.471Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Push the release commit as the push TIP — never a `[skip ci]` commit on top of code

## Guidance
Two linked rules for the exit/release protocol (extends [[2026-05-31-decision-git-sync-protocol-multi-agent]]):

1. **Atomic release commit.** When a task changes shippable code, stage the code + version bump + CHANGELOG **and** the regenerated `.ai/` artifacts (project-context, code-map) **and** the session recap (call `mem_session_end` BEFORE committing) into **one** release commit. The head of history then reflects the real release, not a `chore: sync`.

2. **A `[skip ci]` commit must NEVER be the HEAD of a push that also contains code.** GitHub Actions honors `[skip ci]` / `[ci skip]` / `[no ci]` on the **head commit of a push and skips the entire push's workflow runs** — including any code commits in that same push. This is exactly why CI did not run for v0.12.0/v0.12.1: each push tip was a `chore: haive sync [skip ci]` commit, so the feature commit underneath never triggered CI.

## Correct exit sequence
1. Finish code + tests; build; bump (lockstep) + CHANGELOG.
2. `mem_session_end` (writes the recap) **first**.
3. Final coverage briefing.
4. Stage code + bump + CHANGELOG + regenerated `.ai/` + recap → **one** release commit (NO `[skip ci]`).
5. Tag `vX.Y.Z`.
6. `git pull --rebase`, then `git push` so the **release commit is the push tip** → CI runs. `git push --tags`.
7. `haive enforce finish`. Any *telemetry-only* churn left by running the gate (`.ai/.usage/tool-usage.jsonl`) goes in a SEPARATE, LATER `chore: sync [skip ci]` push — safe, because the release commit's CI already triggered on its own push.

## Why
The agent pushed correctly (remote was in sync, tags present) but CI silently never ran and the feature was buried under sync commits. **How to apply:** also added `workflow_dispatch:` to `.github/workflows/ci.yml` so a run can be triggered manually from the Actions tab as a fallback. Never publish to npm (human does that).
