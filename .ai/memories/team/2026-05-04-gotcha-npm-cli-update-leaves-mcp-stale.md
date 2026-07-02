---
id: 2026-05-04-gotcha-npm-cli-update-leaves-mcp-stale
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/cli/package.json
    - packages/mcp/package.json
  symbols: []
sensor:
  kind: regex
  pattern: npm\s+(install|i)\s+-g\s+@hiveai\/cli
  paths:
    - packages/cli/package.json
    - packages/mcp/package.json
  message: >-
    Always install @hiveai/cli AND @hiveai/mcp together: `npm i -g
    @hiveai/cli@latest @hiveai/mcp@latest`. Installing only the CLI leaves the
    global MCP binary stale.
  severity: warn
  autogen: false
  last_fired: null
tags:
  - release
  - npm
  - ux
  - v0.9.0
created_at: '2026-05-04T01:05:36.619Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.274Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# `npm install -g @hiveai/cli@latest` does NOT update global `@hiveai/mcp`

**Reproduced in v0.9.0**:
- `npm i -g @hiveai/cli@latest` upgrades CLI to 0.9.0
- But `haive-mcp --version` stays on the previously installed version (0.6.0 on this machine)
- Consequence: all new MCP tools (`pattern_detect`, etc.) are **inaccessible** to clients (Claude Code, Cursor) because their configs point to the global `haive-mcp` binary.

**Why**: `@hiveai/mcp` is a separate npm package with its own global binary. It is not a globally hoistable CLI dependency.

**User fix**: `npm i -g @hiveai/cli@latest @hiveai/mcp@latest` (both together).

**Product fix (suggestions)**:
1. Add a CLI vs MCP version-mismatch check to `haive doctor` that suggests the fix command.
2. Or embed the MCP server directly in the `haive` binary (for example `haive mcp --stdio`) so there is only one package to update.
3. Or make `@hiveai/cli` a meta-package that depends on `@hiveai/mcp` AND exposes both binaries.
