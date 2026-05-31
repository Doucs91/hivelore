---
id: 2026-05-31-gotcha-enforcement-is-process-not-violation
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/precommit-check.ts
    - packages/cli/src/commands/enforce.ts
  symbols: []
tags:
  - enforcement
  - positioning
  - precommit
created_at: '2026-05-31T04:47:33.240Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
## Enforcement gate: anchored anti-patterns now hard-block (FIXED 2026-05-31)

**History (pre-fix):** the installed pre-commit hook (`haive enforce check --stage pre-commit`) gated only on *process* (briefing-loaded, decision-coverage *surfaced*, artifacts-clean). `runPrecommitPolicy` did call `preCommitCheck`, but blocking required `isBlockingWarning`: high-confidence **AND** semantic reason **AND** `semantic_score >= 0.75`. Anchor+literal alone → `review`, never block. A `BigInt(a)+BigInt(b)` commit into a file carrying an anchored `attempt`+`decision` against it passed the gate at 100%. README promised "known bad approaches blocked before commit"; reality only surfaced.

**Fix (current):**
1. New config knob `enforcement.antiPatternGate: off | review | anchored | strict` (default **`anchored`**) — `config.ts`.
2. `pre_commit_check` gained `anchored_blocks` (default false at the MCP boundary; the CLI gate opts in). When set, a high-confidence attempt/gotcha that is **anchored to a touched file AND corroborated by the diff** (literal token or semantic ≥ 0.45) is classified `blocking` — `precommit-check.ts` `classifyWarning`.
3. `runPrecommitPolicy` reads the config gate and maps it to `block_on`/`anchored_blocks` — `enforce.ts`.
4. **Deterministic corroboration:** `tokenizeDiffForLiteral` in `anti-patterns-check.ts` now splits the diff on non-word boundaries (len ≥ 4, minus a code stoplist) so identifiers glued to punctuation — `Number(BigInt(a))` — produce a `literal` reason. Previously whitespace-only tokenization meant blocking silently depended on the warmup-sensitive semantic score (first-commit cold-start = no block).

**Still true:** config/docs-only commits never hard-block (`fileTypeDowngradeReason` runs first, only suppresses *non-anchored* matches — see [[2026-05-07-attempt-strict-precommit-gate-on-haive]]). Process gates remain. Loosen with `antiPatternGate: review`, tighten with `strict`.

**Verified:** fresh sandbox, cold embeddings, `--no-semantic` → reasons `["anchor","literal"]`, level `blocking`, the BigInt commit is blocked on the first attempt.
