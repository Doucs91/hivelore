---
id: 2026-06-02-convention-verify-pipelines-before-closing
scope: team
type: convention
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/mcp/src/prompts/post-task.ts
    - packages/cli/src/commands/init.ts
    - CLAUDE.md
  symbols: []
tags:
  - ci
  - workflow
  - agent-behavior
  - github-actions
created_at: '2026-06-02T04:05:00.000Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids:
  - 2026-05-31-decision-git-sync-protocol-multi-agent
  - 2026-06-02-decision-ci-decision-coverage-local-marker
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Verify Pipelines Before Closing

Every agent must verify that the pushed HEAD's GitHub Actions pipeline passes before reporting a task as complete.

Required closeout flow:

1. Commit the work.
2. Push the branch, and push tags when a release version was bumped.
3. Wait for the GitHub Actions workflow runs for HEAD to appear and finish.
4. Confirm every run completed successfully.
5. Run `haive enforce finish` and only close the task after it passes.

Rationale: a local build/test/pass is not enough once the work is pushed. The `0.12.2` release passed local gates but failed the `haive-enforcement` workflow on GitHub Actions after push, so agents must treat remote pipeline success as part of the exit protocol.

