---
id: 2026-07-07-decision-excellence-polish-pass-v0530
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/commands/enforce.ts
    - packages/cli/src/commands/doctor.ts
    - packages/cli/src/commands/sensors.ts
    - packages/cli/src/commands/eval.ts
    - packages/core/src/sensor-suggest.ts
    - packages/core/src/eval.ts
    - packages/core/src/prevention.ts
  symbols: []
tags: []
created_at: '2026-07-07T19:06:18.399Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# Decision Excellence Polish Pass V0530

v0.53.0 — six friction-removal hardening changes (the recurring "agents keep recommending, nobody implements" list). Non-obvious choices future agents must not re-litigate:

1. **Commit-time gate is advisory for EVERYONE (agents too), not just relaxed-humans.** In `buildEnforcementReport`, at stage pre-commit|local a `commitStage` transform downgrades PROCESS_GATE_CODES (briefing-missing, session-recap-missing, decision-coverage-missing, bootstrap-incomplete) errors → warn (impact≤8), and the `enforcement-score-below-threshold` block finding is emitted ONLY when `!commitStage`. This runs AFTER the existing `relaxForHuman` transform (which stays — it additionally relaxes at pre-push for humans). DETERMINISTIC content findings (sensor-block, precommit-policy-block, stale anchors, artifacts) are NOT in the set → still block at commit. Rationale: blocking process gates at every pre-commit trained `--no-verify`; the gates enforce at the SHARING points (pre-push/ci). Do not re-add process-gate blocking at commit.

2. **printReport gained `quiet`** (Lever: silence-on-success). quiet = stage≠ci && !explain && !verbose. On pass with zero error/warn → ONE line. On block/warn → header + block headline + only actionable (error/warn) findings; drops the passing ✓/• noise. CI/`--explain`/new `--verbose` keep the full report. A cold repo still shows its one bootstrap warn — that's correct, not a bug.

3. **Hook self-heal** (Lever: first-run). Refactored the hook bodies into `managedGitHookSpecs()` (single source). New exports: `hookIsStale` (legacy `haive` call OR >1 marker/shebang = broken), `detectStaleGitHooks`, `repairStaleGitHooks` (regenerate via buildHookFileContent — foreign husky preserved). doctor detects (error `stale-git-hook`) by default and REPAIRS under `--fix` (respects doctor's read-only-by-default contract). The repaired finding carries `alwaysShow:true` (else the info floor hides it).

4. **`sensors propose --from-fix <ref>`** (Lever: cheaper arming). Pure core `mineSensorSeedFromDiff(diff, anchorPaths, body?)`: pattern = a distinctive token on a REMOVED line not re-added (the mistake); absent = a token on an ADDED line not previously present (the fix). CLI runs `git diff <ref> HEAD -- <anchors>` and feeds it; the mined pattern STILL goes through full judgeProposedSensor validation. Regex handler was reordered (resolve root/found/anchorPaths BEFORE the pattern-required check) so mining can fill --pattern.

5. **`runValidationContract()`** in core eval.ts (mid-file import of judge/isHarnessErrorOutput/suggestSensorSeed is fine — ESM hoists). Fixed cases freeze the 4 shipped holes (inverted, false-RED, fires-on-current, backwards-seed). `hivelore eval` renders it and hard-fails (process.exitCode=1) like runTierContract. This is the answer to "eval scored 100 while validation had holes".

6. **Evidence-graded prevention** (prevention.ts): each receipt row gets `evidence: proven|incident|documented` (red_proven → proven; else incident ref → incident; else documented). `PreventionReceipt.by_evidence` counts; render adds `Evidence: K red-proven · M incident-linked · N documented-only`. Honest, never inflated.

Chains: [[2026-07-07-decision-behaviour-honesty-inverted-sensor-guard]], [[2026-07-07-attempt-relying-on-hivelore-enforce-install]] (fixed the append bug; this adds the self-heal), [[2026-07-04-decision-gate-surface-integrity-batch-v0390]] (score explanation stays for pre-push/ci), [[2026-07-07-decision-sharpen-surface-harden-gate]] (alwaysShow floor).
