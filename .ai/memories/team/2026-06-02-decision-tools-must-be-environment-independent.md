---
id: 2026-06-02-decision-tools-must-be-environment-independent
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/commands/ingest.ts
    - packages/cli/src/commands/init.ts
  symbols: []
tags:
  - principle
  - portability
  - design
  - integrations
created_at: '2026-06-02T14:23:55.638Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.286Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
## Every hAIve tool must work standalone — zero hard dependency on the user's environment

hAIve is used by anyone on any project. No command, generated file, or workflow may *require* an external service or a specific local setup (SonarQube, a particular MCP server, an API key, a cloud account) to function. If a project doesn't have that thing, hAIve must still work.

**Rules:**
- External integrations are **opt-in** and **degrade gracefully**: when creds/config are absent, print one clear, actionable message and exit non-zero for *that command only* — never crash, never a stack trace, never break unrelated functionality.
- Prefer a dependency-free path: e.g. `haive ingest --from sonar-api` uses Node's built-in `fetch` against the public SonarQube Web API with user-supplied `--sonar-url`/`--sonar-token` (or `SONAR_HOST_URL`/`SONAR_TOKEN`) — it does NOT depend on the user's Sonar MCP being configured. File-based `--from sonar|sarif` always works regardless.
- Generated output (`haive init` workflows/bridges) must not require external secrets beyond `GITHUB_TOKEN` (provided by Actions). Audited 2026-06-02: init only emits haive-sync.yml + haive-enforcement.yml, no forced Sonar/cloud workflow.
- CI helpers must be droppable into any pipeline: e.g. `haive eval --regression-gate` compares against a baseline *if one exists*, else no-ops (exit 0).

**Why:** stated by Sady (2026-06-02): every hAIve-proposed tool must be independent of his environment because it must be usable by anyone. A tool that breaks when a service is missing kills adoption. Relates to [[2026-05-31-decision-git-sync-protocol-multi-agent]] (agents never npm publish) and the zero-infra positioning in PLAN.md.
