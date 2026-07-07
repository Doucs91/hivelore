---
id: 2026-07-07-decision-kill-haive-rename-migration
scope: team
type: decision
status: draft
anchor:
  paths:
    - packages/core/src/config.ts
    - packages/cli/src/commands/init.ts
    - packages/cli/src/commands/enforce.ts
    - packages/cli/package.json
  symbols: []
tags:
  - haive
  - rename
  - migration
  - breaking
  - v0.51.0
created_at: '2026-07-07T06:24:26.746Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Decision Kill Haive Rename Migration

**What (v0.51.0):** killed the `haive` name across the USER-VISIBLE surface, with non-destructive migration (read-legacy, write-new, delete-legacy on write). Supersedes [[2026-07-02-decision-hivelore-rename-compat-strategy]].

Killed / migrated:
- **Binary**: dropped the `haive` (and `haive-mcp`) bin + the `haive` keyword. New installs expose only `hivelore`.
- **Config file**: `.ai/haive.config.json` → `.ai/hivelore.config.json`. `CONFIG_FILE` renamed + `LEGACY_CONFIG_FILE`; `resolveConfigPath` reads new-then-legacy; `saveConfig` deletes the legacy after writing; `init` migrates proactively.
- **Workflows**: `haive-sync.yml`/`haive-enforcement.yml` → `hivelore-*.yml`. installCiEnforcement + init `--with-ci` adopt the legacy managed block, write the new file, and DELETE the legacy (no double CI). Markers `# hivelore:enforcement-workflow:*` (both eras recognised). `isHaiveOwnedPath` matches both `haive-*` and `hivelore-*`.
- **Env**: workflow env `HIVELORE_BASE_SHA`/`HIVELORE_HEAD_SHA` + `HIVELORE_TOOL_PROFILE`; readers fall back to the legacy `HAIVE_*` names (baked into pre-rename workflows).
- **Git hook probe**: dropped the `haive` fallback (probes `hivelore` only). **dev-link**: dropped the `@hiveai` scope fallback.

**Deliberately NOT renamed (bounded scope, still work, invisible/low-value):** the internal runtime env-var plumbing (`HAIVE_SESSION_ID`, `HAIVE_DIR`, `HAIVE_AGENT`, `HAIVE_ENFORCEMENT`, …) read/written between our own hook and CLI; the Claude-hook tag value; the generated bridge FILENAMES (`.cursor/rules/haive-*.mdc`, `.roo/rules/haive.md`); the `HaiveConfig`/`HaivePaths`/`isHaiveOwnedPath` internal symbol names. These are a follow-up.

**Gotcha for future sweeps:** a blind `sed s/haive-sync.yml/.../` broke the migration `legacyCiPath` constant (it MUST stay `haive-sync.yml`). Always exclude the LEGACY_* constants + migration source paths from brand seds.
