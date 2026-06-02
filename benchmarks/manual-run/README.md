# Manual Cursor Benchmark - hAIve vs without hAIve

Two **identical fixtures** (Vitest + Zod): `fixtures/order-haive` (with `.ai/` and team memory) and `fixtures/order-plain` (without `.ai/`).

## Prerequisites

- Global hAIve (for example `haive --version`) to initialize / verify the hAIve arm.
- `pnpm` installed.

## Fixture Setup (on each machine)

In **each** subfolder, `fixtures/order-plain` and `fixtures/order-haive`, use **npm** so pnpm does not walk up to the parent monorepo:

```bash
cd fixtures/order-plain   # or order-haive
rm -rf node_modules
npm install
npm test   # should fail (3 red validation tests)
```

If you prefer pnpm: `pnpm install --ignore-workspace` (otherwise `zod` is not resolved for Vitest).

## Task T1 (same for both arms)

**Goal:** make `pnpm test` pass by modifying only `src/schemas.ts` (and imports in that file only if needed).

**Canonical prompt** (copy-paste exactly):

```text
You are in a small TypeScript project (Vitest + Zod). Make all suites pass:
npm install then npm test.
Only modify src/schemas.ts so CreateOrderInputSchema reflects the rules expected by the tests.
Do not read other repositories or the web.
```

### Arm A - With hAIve

1. Open `benchmarks/manual-run/fixtures/order-haive` as the Cursor window root (or as a dedicated workspace).
2. Enable the **hAIve** MCP; at task start, use `get_briefing` and read team memories (or `haive memory list` / `.ai/memories/...` files).
3. Start a timer when the canonical prompt is first sent.
4. Stop at the first fully green `pnpm test` run (or at the agreed time budget).
5. Record in `RESULTS.md`: time, terminal errors, token estimate (if the UI/API provides it), human/agent iterations.

### Arm B - Without hAIve

1. Use a **new** Cursor window or chat **without** the hAIve MCP server (and without opening `.ai/` files from the parent repo).
2. Open only `benchmarks/manual-run/fixtures/order-plain`.
3. Use the same canonical prompt and the same measurement procedure.

### Limits (methodology honesty)

- Two separate sessions are required to limit **contamination** (remembering the fix). The pilot below was run by one agent sequentially: the "agent" times are indicative; comparisons from the **same model** in two clean chats are more reliable.

## Useful Files

- Good memory (hAIve arm only):
  `fixtures/order-haive/.ai/memories/team/2026-05-05-convention-order-input-zod.md`
- Truth tests: `fixtures/*/test/order.test.ts`

Record metrics in `RESULTS.md` (model + date + branch).
