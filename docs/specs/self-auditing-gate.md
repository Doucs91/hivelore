# Spec — The Self-Auditing Gate (v0.35.0)

> **For the implementing agent.** This document is the full scope. Read it entirely before writing
> code. Work happens in THIS repo. Follow `CLAUDE.md` (Hivelore MCP rules, git sync protocol) at all
> times: `get_briefing` before editing, `git pull` first, `mem_tried` immediately on failed
> approaches, decision memories for non-obvious choices, `hivelore enforce finish --wait` green
> before calling anything done. A reviewing agent will verify every acceptance criterion below.

## 1. Goal

Hivelore's gate blocks repeats of documented mistakes. What it lacks is **accountability for
itself**: proof that its blocks are trustworthy, that it improves when it misses, and that the value
it delivers is visible. This release adds three features on ONE shared substrate:

1. **Sensor health ledger + flaky quarantine** — trust: a flaky oracle must never hard-block.
2. **Gate-miss detection** — learning: a revert/hotfix of a gate-passed commit becomes a draft lesson.
3. **Prevention receipt** — visible ROI: weekly summary + CI pull-request comment.

## 2. Doctrine — hard constraints (violating any of these = rejected review)

- **Deterministic only.** No LLM-as-judge, no semantic scoring in any block/demote decision.
- **Never auto-block from new machinery.** New drafts/sensors are `proposed`; only the existing
  `propose_sensor` validation pipeline can arm a blocking sensor.
- **Never auto-delete.** Retirement/quarantine demotes or flags; a human (or explicit command) removes.
- **Telemetry must never break a commit.** All ledger writes are best-effort (swallow failures),
  same pattern as `recordPreventionHits` in `packages/core/src/prevention.ts`.
- **No new external dependencies.** git, the GitHub token already present in CI, and the existing
  stack only.
- **Machine-local runtime data lives under `.ai/.runtime/`** (gitignored); only conclusions that are
  team truth (a demoted sensor severity, a draft lesson) touch the committed corpus.

## 3. Shared substrate — the sensor evaluation ledger

**New module: `packages/core/src/sensor-ledger.ts`** (exported from core index).

Every sensor evaluation at the gate is recorded, one NDJSON line per sensor per run:

```
File: .ai/.runtime/enforcement/sensor-ledger.ndjson   (append-only, gitignored via .runtime)

interface SensorEvaluation {
  at: string;              // ISO timestamp
  memory_id: string;       // sensor's memory
  kind: "regex" | "shell" | "test";
  stage: "pre-commit" | "pre-push" | "ci" | "manual";   // manual = `sensors check`
  head_sha: string;        // git HEAD at evaluation time
  scope_hash: string;      // sha256 over the CONTENT of the files the sensor is scoped to
                           // (sensorAppliesToPath matches), sorted by path. Empty scope → "".
  outcome: "fired" | "silent" | "unrunnable";
  exit_code?: number;      // command sensors
  duration_ms?: number;    // command sensors
}
```

API (all best-effort, never throw):
- `appendSensorEvaluations(paths, evaluations: SensorEvaluation[])`
- `loadSensorLedger(paths, opts?: { since?: string }): Promise<SensorEvaluation[]>`
- `computeScopeHash(root, scopedFiles: string[]): string`
- Cap the file at 10_000 lines: on append, if over, rewrite keeping the newest 8_000 (documented in
  the module header — the ledger is a rolling window, not an archive).

**Wire it in `packages/cli/src/commands/enforce.ts` (runSensorGate) and `sensors check`**: after
sensors are evaluated, append one entry per evaluated sensor (fired AND silent AND unrunnable —
silent entries are what make flap detection possible). Also record `head_sha` for phase-2
cross-referencing when the overall gate PASSES (add a synthetic entry `memory_id: "__gate__"`,
`outcome: "silent"` meaning "gate passed this commit", `kind: "shell"`, same head_sha — or a
dedicated `gate-passes.ndjson` next to the ledger if cleaner; your choice, document it in a decision
memory).

## 4. Phase 1 — Flaky quarantine (trust)

**Scope: command sensors only.** Regex sensors are pure functions of the diff — they cannot flap.

**Definition of a flap** (deterministic): two evaluations of the same `memory_id` with **identical
`scope_hash`** and **different outcomes** (`fired` vs `silent`), within the last 30 days.
`unrunnable` never counts toward flap detection.

**Rules:**
- ≥ 2 flaps in 30 days on a `severity: block` command sensor → **quarantine**: demote the sensor to
  `severity: warn` in the memory file's frontmatter AND append one line to the memory body:
  `> Quarantined <ISO date>: oracle flapped N× on identical inputs — demoted block→warn. Fix the test, then re-promote with \`hivelore sensors promote <id>\`.`
- The demotion is applied by **`hivelore sync`** (corpus-touching pass) and by **doctor** detection;
  the GATE ITSELF never edits memory files mid-commit. At gate time, a quarantine-pending sensor
  detected from the ledger is already treated as `warn` (in-memory downgrade) with the finding below.
- New findings:
  - `sensor-flaky` (warn, doctor + gate): names the memory id, the flap count, the last two
    contradictory evaluations (timestamps + outcomes).
  - `sensor-never-fired` (info, doctor only): sensor evaluated ≥ 20 times across ≥ 30 days with zero
    `fired` → retirement candidate, fix hint: `hivelore sensors retire <id>` **only if** such a
    command already exists; otherwise hint manual review. Do NOT create a delete command.
- Re-promotion is manual via the existing `sensors promote` path (verify it restores `block`; extend
  it if needed so promoting clears the quarantine note).

**Acceptance (phase 1):**
- Unit tests: flap detection (same hash different outcomes → flap; different hash → no flap;
  unrunnable ignored), 30-day window, demotion writes frontmatter + body note exactly once
  (idempotent re-sync), in-memory downgrade at gate time.
- E2E test (cli.test.ts style): a command sensor whose oracle alternates pass/fail on identical
  tree (e.g. a script reading a counter file OUTSIDE the scoped paths) gets quarantined after the
  second flap; the gate then warns instead of blocking; `sensors promote` restores block.

## 5. Phase 2 — Prevention receipt (visible ROI)

**New command: `hivelore stats receipt [--since 7d] [--json]`** in
`packages/cli/src/commands/stats.ts` (subcommand of the existing `stats`).

Data sources (all existing): `loadPreventionEvents` + `computePreventionTrend`
(`packages/core/src/prevention.ts`), usage.json `prevented_count`, and memory frontmatter for titles.

Human output (design for copy-paste into Slack):
```
Hivelore prevention receipt — last 7 days
  4 repeat mistakes refused before they reached review.
  ✗→✓ 2026-07-01  refund-exceeds-capture       (test sensor, exit 1 — caught at pre-commit)
  ✗→✓ 2026-06-30  stripe-missing-idempotency   (regex sensor — caught at pre-commit)
  ...
  Trend: 4 this week vs 9 last week (recurrences declining).
```
`--json` emits the same as a machine-readable object (stable keys; this feeds the CI comment).

**CI PR comment.** Extend the enforcement workflow template (the generator that writes
`.github/workflows/haive-enforcement.yml` — regenerate templates, respect the existing marker-based
update mechanism so existing repos pick it up on `enforce install`):
- Only on `pull_request` events, after the gate step, always (pass or fail).
- Build the comment from `hivelore stats receipt --json` + the gate findings of THIS run (sensors
  that fired on the PR's diff).
- Upsert a single comment identified by the marker `<!-- haive:prevention-receipt -->` (find
  existing comment via `gh api`, patch it; create otherwise). Comment shows: what fired on this PR
  (with the lesson's message and `memory_id`), then the weekly totals.
- **Degrade silently**: no token, fork PR, not a PR event, `gh` missing → skip without failing the job.

**Acceptance (phase 2):**
- Unit tests for receipt aggregation (empty log, window filtering, json shape).
- Workflow template test (there are existing tests asserting generated workflow content — extend).
- E2E: seed a prevention log in a sandbox, run `stats receipt`, assert output lists the events and
  the trend line.

## 6. Phase 3 — Gate-miss detection (the learning loop)

**Where:** `hivelore sync` (auto pass) + a manual `hivelore memory seed-git --watch`-equivalent is
NOT needed — sync is the entry point.

**Mechanism:**
- Track the last scanned commit in `.ai/.runtime/enforcement/git-watch.json`
  (`{ last_scanned_sha: string }`). First run initializes to HEAD without scanning history
  (the one-time historical pass already exists at init via seed-git — do not duplicate it).
- On each `hivelore sync`: scan `last_scanned_sha..HEAD` with the existing revert/hotfix detection
  (`proposeSeedsFromCommits`, `isNoiseSubject` in `packages/core/src/seed-git.ts`). For each signal:
  - Create a **proposed** (never validated) lesson via the existing seed-draft path, tagged
    `gate-miss`, body carrying provenance: reverted SHA, revert SHA, subject, and the revert diff's
    top file paths as anchor candidates.
  - Cross-reference the ledger/gate-passes: if the reverted commit's SHA was recorded as a gate
    pass, add to the draft body: `The gate PASSED this commit — a validated sensor here upgrades the
    harness.` and include the `proposed_sensor_seed` hint (reuse the existing seed-suggestion logic
    from mem_tried).
- New doctor/briefing surfacing: doctor info `gate-miss-drafts` (count + ids + "review with
  `hivelore memory list --status proposed`"); get_briefing already surfaces proposed memories as
  `[UNVERIFIED]` — verify the tag shows up, don't build a new channel.
- Dedup: a revert already covered by an existing `gate-miss` draft (same reverted SHA) is skipped.

**Acceptance (phase 3):**
- Unit tests: watch-state init at HEAD, incremental scan window, dedup by reverted SHA, provenance
  content, gate-pass cross-reference.
- E2E: sandbox repo — commit A passes the gate (recorded), commit B reverts A; `hivelore sync`
  produces exactly one proposed `gate-miss` lesson naming A; second `sync` produces nothing new.

## 7. Order, releases, verification ritual

- Implement in phase order 1 → 2 → 3; each phase lands as its own commit with green local tests.
- **One release at the end**: `hivelore release bump minor --title "the self-auditing gate — flaky quarantine, prevention receipts, gate-miss drafts"`
  (0.34.x → 0.35.0), CHANGELOG filled per phase, `release tag`, push, `enforce finish --wait` green.
  npm publish is Sady's step — never run it.
- **Local verification before every push** (two CI failures last release came from skipping these):
  1. `pnpm -r typecheck` (tsup and vitest do NOT typecheck),
  2. full `pnpm -r test`,
  3. CLI suite once with a bare HOME (`HOME=$(mktemp -d) npx vitest run` in packages/cli) — anything
     touching detection/machine state must pass on a naked runner.
- Save decision memories (`mem_save type=decision`) for: ledger file format/rotation choice, the
  flap definition, the gate-pass recording shape. `mem_session_end` with discoveries at the end.

## 8. Explicitly OUT of scope

- Any LLM/semantic judgment anywhere in these features.
- Auto-deleting sensors or memories; auto-promoting drafts to validated.
- External integrations (Sentry, PagerDuty, Slack webhooks) — the receipt is CLI + PR comment only.
- Trajectory/mid-session observation.
- Committing the ledger or any `.ai/.runtime/` file.
- Touching the npm publish pipeline.
