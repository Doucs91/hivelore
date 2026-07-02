---
id: 2026-04-27-decision-zod-error-formatting-no-direct-import
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/index.ts
  symbols:
    - isZodError
tags:
  - cli
  - ux
  - zod
  - error-handling
created_at: '2026-04-27T17:19:48.915Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.267Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Decision Zod Error Formatting No Direct Import

The CLI catches ZodError via duck-typing (`isZodError` checks for `.issues` array) rather than importing `ZodError` from `zod` directly. Reason: `zod` is not in `@hiveai/cli`'s direct dependencies — it's only a dep of `@hiveai/core`. In pnpm workspaces without hoisting, a direct `import { ZodError } from "zod"` in the CLI bundle fails at runtime with `ERR_MODULE_NOT_FOUND` when installed globally.
