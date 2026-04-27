---
id: 2026-04-27-gotcha-version-define-tsup-and-vitest
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/mcp/src/server.ts
    - packages/mcp/src/index.ts
    - packages/cli/src/index.ts
  symbols:
    - SERVER_VERSION
    - __HAIVE_VERSION__
tags:
  - build
  - tsup
  - vitest
  - versioning
created_at: '2026-04-27T17:20:23.358Z'
expires_when: null
verified_at: '2026-04-27T17:21:21.343Z'
stale_reason: null
---
When using tsup `define` to inject a constant (e.g. `__HAIVE_VERSION__`), vitest does NOT apply the tsup config — it runs source files directly. Any package whose tests import source files referencing a `define`-injected global must have its own `vitest.config.ts` with the same `define`, reading the version from `package.json` at config-load time.

Also: scan ALL files for hardcoded version strings before publishing — `server.ts` and `index.ts` both had `v0.1.0` in the startup log of `@hiveai/mcp`.
