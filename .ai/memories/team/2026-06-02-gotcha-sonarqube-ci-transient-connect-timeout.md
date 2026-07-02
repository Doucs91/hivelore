---
id: 2026-06-02-gotcha-sonarqube-ci-transient-connect-timeout
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - .github/workflows/sonar.yml
    - sonar-project.properties
  symbols: []
tags:
  - ci
  - sonarqube
  - flake
  - enforce-finish
created_at: '2026-06-02T04:17:33.245Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.287Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Gotcha Sonarqube Ci Transient Connect Timeout

The `sonarqube` GitHub Actions workflow occasionally fails fast (~30s) with `ERROR Failed to query server version: Call to URL [.../api/v2/analysis/version] failed: Connect timed out`. This is a **transient network flake** reaching the self-hosted SonarQube server from the GitHub runner — NOT a code regression. Recent commits' sonarqube runs succeed in ~1m30s.

**Trap:** `haive enforce finish` blocks with `github-actions-failed: sonarqube#<id>` and the fix text says "fix the issue, push the fix" — but there is nothing to fix in the code.

**Instead, use:** re-run the failed workflow with `gh run rerun <run-id> --failed`, wait with `gh run watch <run-id> --exit-status`, then re-run `haive enforce finish`. Only investigate the code if it fails repeatedly (real Sonar quality-gate failure looks different — it gets past the version query and reports issues).
