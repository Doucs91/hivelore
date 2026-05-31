---
id: 2026-04-30-session_recap-recap
scope: team
type: session_recap
status: validated
anchor:
  paths:
    - packages/core/src/config.ts
    - packages/mcp/src/tools/precommit-check.ts
    - packages/mcp/src/tools/anti-patterns-check.ts
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/precommit.ts
    - packages/cli/src/commands/init-bootstrap.ts
    - packages/cli/src/commands/memory-verify.ts
    - packages/cli/src/commands/index-code.ts
    - packages/cli/src/commands/init.ts
    - .github/workflows/ci.yml
    - README.md
    - CHANGELOG.md
    - packages/mcp/test/anti-patterns.test.ts
  symbols: []
tags:
  - session
  - recap
created_at: '2026-04-30T00:02:07.282Z'
expires_when: null
verified_at: '2026-05-31T14:39:40.321Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: session-recap-team
revision_count: 9
requires_human_approval: false
---
## Goal
Audit hAIve end-to-end, reconcile a second agent's audit, then fix all identified quality gaps so the product is solid before adding features.

## Accomplished
Shipped 8 fixes (all 240 tests green, typecheck clean):
- Honest enforcement gate: new enforcement.antiPatternGate (off|review|anchored|strict, default anchored); pre_commit_check anchored_blocks param; runPrecommitPolicy wires it; anchored+diff-corroborated high-confidence attempt/gotcha now hard-blocks.
- Deterministic literal matching: tokenizeDiffForLiteral splits diffs on non-word boundaries (len>=4, code stoplist) so glued identifiers like Number(BigInt(a)) produce a literal reason.
- Stack detection scans .ts/.tsx when no tsconfig.json (was mislabeled JavaScript).
- --files alias for --paths on memory add/tried/update.
- memory verify --json; index code --status [--json].
- CI: typecheck before tests + blocking (removed continue-on-error).
- init message clarifies user-level vs project-level MCP config.
- README aligned: precise blocking wording + honest n=3 pilot benchmark.
Added 5 MCP regression tests (82 pass). Updated CHANGELOG [Unreleased].

## Discoveries & surprises
1. CORE: the installed pre-commit hook DID run anti-pattern matching, but isBlockingWarning required semantic_score>=0.75, so anchor+literal anchored violations were only 'review' — the BigInt-into-anchored-file case passed the gate at 100%. README's 'blocked before commit' was untrue in practice.
2. literalMatchesAnyToken never fired on real code diffs: tokenizeQuery splits on whitespace only, so Number(BigInt(a)) becomes one un-matchable blob. Blocking silently depended on warmup-sensitive semantic — first cold-start commit did NOT block, a warm one did (non-deterministic gate). Fixed with tokenizeDiffForLiteral.
3. fileTypeDowngradeReason config-only downgrade only suppresses NON-anchored warnings (requires !reasons.includes('anchor')). An anti-pattern genuinely anchored to package.json legitimately blocks — corrected a test I wrote that wrongly expected 'info'.
4. PreCommitCheckInput is a mapped type over the zod schema, so adding anchored_blocks (even with .default(false)) made it REQUIRED for TS callers and broke precommit.ts — caught only because I made typecheck blocking in CI. Good signal that the CI change pays off immediately.
5. The second agent's '2/35 CLI tests red' (session-recap wording, stale-draft-memories) were stale-dist artifacts: source already emits 'Session with N changed files' and the stale-draft code exists; both pass after a clean build. Root cause is build/dist desync, not test bugs — addressed via CI hardening.

## Files touched
- `packages/core/src/config.ts`
- `packages/mcp/src/tools/precommit-check.ts`
- `packages/mcp/src/tools/anti-patterns-check.ts`
- `packages/cli/src/commands/enforce.ts`
- `packages/cli/src/commands/precommit.ts`
- `packages/cli/src/commands/init-bootstrap.ts`
- `packages/cli/src/commands/memory-verify.ts`
- `packages/cli/src/commands/index-code.ts`
- `packages/cli/src/commands/init.ts`
- `.github/workflows/ci.yml`
- `README.md`
- `CHANGELOG.md`
- `packages/mcp/test/anti-patterns.test.ts`

## Next steps
Optional follow-ups (not blockers): (a) consider defaulting the standalone `haive memory verify`/doctor to surface anchorless technical conventions for anchoring; (b) trim the 54-command CLI surface behind the existing profile system; (c) add a CLI integration test for the anchored gate blocking a real staged commit; (d) decide whether to bump version + release these as 0.9.30.
