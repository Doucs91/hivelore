---
id: 2026-06-07-convention-vscode-cli-calls-through-runhaive
scope: team
type: convention
status: validated
anchor:
  paths:
    - packages/vscode/src/extension.ts
    - packages/vscode/src/briefingPanel.ts
    - packages/vscode/src/observabilityProvider.ts
  symbols: []
sensor:
  kind: regex
  pattern: 'cp\.(exec|spawn|execFile|execSync)\s*\('
  paths:
    - packages/vscode/src/extension.ts
    - packages/vscode/src/briefingPanel.ts
    - packages/vscode/src/observabilityProvider.ts
  message: 'Raw child_process in the extension — call runHaive() (harnessHealth.ts) instead; only runHaive may shell out.'
  severity: block
  autogen: false
  last_fired: null
tags:
  - vscode
  - convention
  - cli
created_at: '2026-06-07T23:04:51.836Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
## VS Code extension: all hAIve CLI calls go through `runHaive()`, never raw child_process

Every invocation of the `haive` CLI from the extension must use **`runHaive(cwd, args)`** (defined in
`packages/vscode/src/harnessHealth.ts`). `runHaive` is the single, intentional place that shells out:
it centralizes the configured binary, cwd/root resolution, `maxBuffer`, and error handling.

**Do NOT** call `child_process` directly (`cp.exec`, `cp.spawn`, `cp.execFile`, `cp.execSync`) from any
other extension file (`extension.ts`, `briefingPanel.ts`, `observabilityProvider.ts`, …). A raw call
bypasses root resolution and error handling and drifts from the configured binary.

**Instead, use:** `await runHaive(workspaceRoot, ["sync"])` and friends.

The only file allowed to touch `child_process` is `harnessHealth.ts` (the `runHaive` implementation).
