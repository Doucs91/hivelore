---
id: 2026-05-31-decision-git-sync-protocol-multi-agent
scope: team
type: decision
status: validated
anchor:
  paths:
    - .ai/project-context.md
  symbols: []
tags:
  - git
  - workflow
  - coordination
  - versioning
  - multi-agent
created_at: '2026-05-31T22:25:44.873Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.276Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Git sync protocol for multi-agent work

## Guidance
Several agents and the human (Sady) work in parallel on this repo with manual pull/push flows. Without a shared protocol, conflicts happen (for example conflict markers left in `.ai/project-context.md`) and versions drift out of sync.

MANDATORY PROTOCOL FOR EVERY AGENT:

BEFORE starting a task (entry):
1. `git pull` (fetch the latest version from GitHub).
2. Resolve any conflicts BEFORE touching code.
3. Verify that no conflict markers remain (`<<<<<<<`, `=======`, `>>>>>>>`), especially in `.ai/`.

AFTER modifying code (exit):
1. Commit the changes.
2. Version bump ONLY if deliverable code changes (publishable packages: `@hiveai/core`, `cli`, `mcp`, `embeddings`). Commits that only touch docs / `.ai/` / config / CI get committed and pushed WITHOUT a bump or tag.
3. If bumping: patch by default (`0.10.1` -> `0.10.2`). Use minor/major only when justified (feature / breaking). Keep the 4 publishable packages in lockstep.
4. If bumping: create the matching git tag `vX.Y.Z`.
5. Push code AND tags to GitHub (`git push && git push --tags`).

BOUNDARY: the agent NEVER publishes to npm. npm publication is done by the human (Sady).

## Why
Because multiple agents and the human push/pull the same branch concurrently, skipping `git pull` before a task causes merge conflicts (conflict markers were left in `.ai/project-context.md`) and version drift between local work and GitHub. The rule exists to force a clean, current base before editing and a consistent commit/tag/push afterwards.

What to do instead of working blind: always `git pull` and clear conflict markers first; after shippable code changes, bump (patch by default, lockstep across the 4 publishable packages), tag `vX.Y.Z`, and `git push --tags`; never run `npm publish` — leave npm publication to the human (Sady).
