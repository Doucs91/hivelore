# Results - Manual Benchmark

Model (Cursor): _to be completed by the runner_
Date: 2026-05-05
Branch: _local_

## T1 - `CreateOrderInputSchema` Validation

| Arm | Open project | hAIve briefing / memories | Time to green (wall-clock) | Terminal errors (count) | Test-to-fix iterations | Tokens (in/out) | Notes |
|-----|--------------|---------------------------|----------------------------|-------------------------|------------------------|-----------------|-------|
| A - hAIve | `fixtures/order-haive` | MCP `get_briefing`: 0 memories returned (MCP root != fixture); memory read from disk `.ai/memories/team/...` | ~agent session (not strictly timed); post-fix `pnpm test` **1.35 s** | 0 after schema correction; setup phase: `zod` failure fixed with `pnpm install --ignore-workspace` | 1 (schema -> green tests) | N/A | Applied fix: `z.number().int().positive()` + `z.string().trim().min(1)` aligned with memory |
| B - without hAIve | `fixtures/order-plain` | None | same; `pnpm test` ~0.4 s | 0 after correction | 1 | N/A | Fix possible without memory: `z.number().int().min(1)` + `z.string().min(1)`; `.trim()` is not required by tests |

### Infrastructure Notes (outside the ideal protocol)

- The fixtures live **under a pnpm monorepo**: a normal `pnpm install` from the subfolder walks up to the workspace and Vitest cannot see `zod`. **Recommended in the RUNBOOK**: `npm install` / `npm test` in the subfolder, or `pnpm install --ignore-workspace`.

### Next

- Rerun T1 with **two distinct chats**, same model, timed from prompt send to green tests.
- Repeat N>=5 per arm for an average / median.
