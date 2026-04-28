---
id: 2026-04-28-attempt-npm-install-g-packagescli-packagesmcp
scope: team
type: attempt
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - npm
  - publish
  - install
  - dev-workflow
created_at: '2026-04-28T04:17:56.967Z'
expires_when: null
verified_at: null
stale_reason: null
---
# npm install -g packages/cli packages/mcp (install local monorepo packages globally)

**Why it failed / do NOT use:** npm treats local directory paths as git URLs when multiple are given, fails with ENOENT or git clone errors

**Instead, use:** build first with pnpm -r build, then hot-swap dist files: cp -r packages/cli/dist/* $(node -e "console.log(require.resolve('@hiveai/cli').replace('/dist/index.js',''))")/ — or publish to npm and install from registry
