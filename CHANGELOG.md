# Changelog

All notable changes to Hivelore are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and the
project follows semantic versioning once it ships its first stable release.

## [Unreleased]

## [0.52.1] — Idempotent git-hook regeneration (post-rename repair)

- **`enforce install` now REPLACES a stale hook block instead of appending a duplicate.** A repo
  installed before the v0.51.0 `haive`→`hivelore` rename kept `.git/hooks/{pre-commit,pre-push,
  commit-msg}` calling the removed `haive` binary directly; `enforce install` keyed idempotency on the
  *current* marker string, did not recognise the legacy `# hAIve enforcement hook` block, and appended
  the new probe below it — a two-block hook whose dead `haive` line ran first and aborted **every
  commit** with `haive: not found`. Hook regeneration now strips any Hivelore-owned block (current OR
  legacy hAIve shape, plus a previously-appended duplicate) and rewrites a single clean block. A
  genuinely foreign hook (husky/custom) is still preserved, with our block appended after it and no
  stray mid-script shebang. New pure, tested helpers `stripHiveloreHookBlock` / `buildHookFileContent`;
  regeneration is now a fixed point (re-running install never grows or duplicates the hook).

## [0.52.0] — Behaviour-harness honesty + inverted-sensor guard

Four hardening fixes concentrated on the branch Hivelore leads — no philosophy change, no new surface.

- **prove-RED no longer accepts a crash as a RED.** The replay classified *any* non-zero exit at
  `red_ref` as proof — so an oracle that errored before reaching its assertion (the guarded code/test
  doesn't exist yet at the pre-fix commit → `Cannot find module`, a `SyntaxError`, `no tests found`)
  was recorded `red_proven: true`, fabricating a guarantee. `proveRedOnIncident` now runs the failure
  output through the new pure `isHarnessErrorOutput` and returns `red-unrunnable` (proves nothing)
  instead — the same "unrunnable ≠ failed" honesty already applied on the current tree. A genuine
  assertion failure is still a real RED. **Conservative by design:** applied only to the prove-RED
  path, never the gate executor (over-classifying at the gate would demote a real block to a warn).
- **Inverted sensors are rejected.** A `block` regex proposal whose pattern matches the lesson's OWN
  recommended fix (its `Instead, use:` snippet) is refused with reason `fires-on-correct` — it would
  block the correct code and never the mistake. New `SensorSelfCheck.fires_on_correct` +
  `extractCorrectApproachExamples`; enforced in `propose_sensor`, the CLI `sensors propose`, and
  `sensors promote`. The flagship `moment`→`date-fns` flow is unaffected (the pattern targets the
  mistake, not the fix).
- **`memory tried` never suggests the recommended tool as the pattern.** The seed excluded the
  `Instead, use:` clause but not the recommendation when it leaked into the why-failed line
  ("team standard is date-fns" → seed `date-fns`, a sensor firing on the fix). Recommended tokens are
  now excluded from the fallback/assignment picks; with no faulty token left the seed is honestly
  `null` (author it yourself) rather than inverted. The "X without Y" companion trigger is untouched.
- **Behaviour coverage no longer vanishes on small repos.** `doctor`'s `behaviour-coverage` finding
  returned nothing when no main area could be derived (a single-package `src/` under the file
  threshold) — even with a red-proven oracle armed. It now still reports armed/red-proven oracle
  counts in that case, so the measure acknowledges protection wherever it exists.

## [0.51.0] — Kill `haive`: one name, with migration

The legacy `haive` name is retired across the user-visible surface. Migration is automatic and
non-destructive — a pre-rename repo keeps working and is converted on the next `hivelore init` /
`enforce install`.

- **Binary**: only `hivelore` (and `hivelore-mcp`) are installed now; the `haive` / `haive-mcp` bins are gone.
- **Config file**: `.ai/haive.config.json` → `.ai/hivelore.config.json`. The loader reads the legacy file
  as a fallback and migrates it (writes the new name, deletes the old) on the next save; `init` migrates
  proactively, preserving your settings.
- **Workflows**: `haive-sync.yml` / `haive-enforcement.yml` → `hivelore-*.yml`. Installing adopts the legacy
  managed block and removes the old file so CI never runs twice. Workflow env vars are now `HIVELORE_*`
  (readers still accept the legacy `HAIVE_*` baked into old workflows).
- **Git hooks** probe only `hivelore`; `hivelore dev link` no longer falls back to the legacy `@hiveai` scope.

Internal implementation names (some `HAIVE_*` runtime env plumbing, generated bridge filenames, internal
symbols) are unchanged for now and continue to work.


## [0.50.0] — Sharpen the surface, harden the gate

Concentrate on the un-copyable core; cut noise.

- **Fail-open hardened.** A `sensor-gate-errored` (the sensor machinery threw, so NO sensors were
  evaluated — the one way the deterministic layer silently goes dark) now **fails the build in CI**
  instead of a quiet warning. A green CI that evaluated no sensors is a lie about protection. Locally it
  stays non-blocking but is a loud, high-impact finding.
- **Fuzzy review matches off by default.** The aggregated "N documented lessons plausibly match — review"
  finding is hidden unless `enforcement.reviewMatches: true` (or `antiPatternGate: "review"`). It fired on
  nearly every commit and was skimmed past; only a deterministic sensor block is signal.
- **`hivelore doctor` hides informational findings by default** (`--all` to show them), keeping warn/error
  and the coverage metrics visible so the report stays actionable.
- **`hivelore release ship`** — one command for the release close-out: `git pull --rebase` → tag + push →
  poll CI via `enforce finish --wait`.


## [0.49.0] — Less ceremony, more gate

Cut friction so effort concentrates on the un-copyable core. No change touches the deterministic
sensor/block path.

- **Passive capture is silent until signal.** Failure distillation now always drops navigation/setup
  builtins (`cd`, `mkdir`, `echo`, `cp`, `mv`, `rm`, `test`, …) and keeps a draft only when the failure
  *repeats* (a retry loop) or the command is substantive (test/build/typecheck/lint). A one-off ordinary
  failure — e.g. a `cd` into a missing dir — no longer becomes a proposed "lesson".
- **Decision memories only for the unguessable.** The `post_task` prompt now states the bar explicitly:
  for a routine change, capturing nothing is the correct outcome — a corpus of restated obvious facts
  makes every briefing worse.
- **Release papercut fixed.** `.ai/.usage/` (machine-local tool-usage telemetry, never team truth) is
  gitignored by `hivelore init`, so the working tree no longer goes dirty on every invocation.
- **Bootstrap gate bound to sharing points.** The first-agent bootstrap block now fires only at
  pre-push / CI / `enforce finish`; at pre-commit and local it is a warning. Quick local iteration and
  throwaway repos are no longer blocked (which trained `--no-verify`), while a cold repo still can't be
  shared without its baseline.


## [0.48.0] — Cheaper oracles: property-based and differential scaffolds

- `hivelore sensors scaffold` and the `scaffold_test` MCP tool gained a `--style` axis that lowers the
  cost of expressing the invariant the behaviour harness leaves to you — without any LLM guessing your
  assertion:
  - `--style property` generates a fast-check (vitest/jest) or Hypothesis (pytest) skeleton: state the
    invariant once and it is checked over many generated inputs. Names the subject from `--red-ref`
    hints and embeds the lesson's expected-fix text as the invariant comment.
  - `--style differential --reference <import>` generates a skeleton that asserts the subject *agrees*
    with a reference implementation for all generated inputs — no invariant to state at all.
- Every style stays a pending, fully-commented stub (the suite stays green) and arms through the same
  validated prove-RED path once filled in. New pure core API: `ScaffoldStyle`, `normalizeScaffoldStyle`,
  and the `style` / `reference` options on `scaffoldPostIncidentTest`. Go emits a gopter hint.


## [0.47.0] — Behaviour coverage closes the loop to action

- `hivelore doctor`'s `behaviour-coverage` finding now points at the exact next command for each
  uncovered area, not just a count. `assessBehaviourCoverage` gained `uncoveredAreaSuggestions`: for
  every uncovered area it finds a scaffoldable lesson (an anchored attempt/gotcha not yet a behavioural
  oracle, preferring incident-shaped `attempt`) and doctor prints
  `hivelore sensors scaffold <id> --red-ref <pre-fix-commit>   # guard <area>` in its Suggested
  commands — or a `memory tried … then scaffold` line when no lesson exists there yet. Measure → action.


## [0.46.0] — Oracle assist: scaffold the test around the fix

- `hivelore sensors scaffold` and the `scaffold_test` MCP tool gained `--red-ref` / `red_ref`. Given the
  pre-fix incident commit, the scaffold names the symbols the fix (`red_ref..HEAD`, scoped to the lesson's
  anchors) actually touched and pre-fills the commented example around them (`import { refund } …`,
  `expect(refund(…)).toBe(…)`) instead of a generic `subjectUnderTest()` — turning "fill the assertion"
  into a targeted edit. New pure core helper `incidentHintsFromDiff(diff)` does the extraction (tracks the
  enclosing function so a body-only change still names its function; const additions rank second).
- The enriched example stays a **pending, commented** stub (no live import) so the suite stays green, and
  the git diff is read without shell interpolation. A bad ref falls back to the generic template. This is a
  deterministic head-start, never an LLM inventing the assertion; `propose_sensor` remains the sole
  validated arming path.


## [0.45.0] — Behaviour-harness coverage metric

- The behaviour harness (command/test sensors routing a real oracle, optionally red-proven) now has a
  visible coverage metric. New pure core API `assessBehaviourCoverage({ memories, codeFiles })` reports,
  per main code area, whether a behavioural oracle guards it, how many are armed (`block`), and how many
  are red-proven — using the same area derivation as the bootstrap gate (`deriveMainAreas`, now shared).
- `hivelore doctor` surfaces it as an info finding in the Protection section
  ("Behaviour harness: X/N area(s) guarded (K armed, P red-proven)", naming uncovered areas), and the
  human `hivelore stats receipt` prints it as a one-line footer. Always info — the behaviour harness is
  opt-in, so this measures progress without nagging.


## [0.44.1] — Large-diff gate robustness

- Fixed a `RangeError: Maximum call stack size exceeded` that crashed the pre-commit gate (and blocked
  every commit with an unactionable message) on a very large staged diff — a staged `node_modules`, a
  generated megafile, or a lockfile. `stripAiDirHunks` / `stripTestHunks` now split hunks with a loop
  instead of `out.push(...block)`, which overflowed the call-argument limit on a single huge hunk.
- `hivelore sensors check` no longer fails silently (`git diff --cached … maxBuffer length exceeded`)
  on a multi-MB staged diff: the staged-diff reader now allows up to 256 MB.
- Capped the review-only fuzzy corroboration (literal token overlap + semantic embedding) at 20,000
  added lines, cutting a 200k-line diff from ~9 s to ~1.5 s. Anchored lessons and deterministic
  sensors — the block path — are never capped; above the cap the gate emits a `precommit-policy-notice`
  info finding ("did you stage node_modules?").
- `HIVELORE_DEBUG=1` now prints the full stack for a swallowed top-level error, so a crash deep in
  diff processing can be located instead of surfacing as a bare message.


## [0.44.0] — Harness correctness and evidence hardening

- Fixed manual `sensors check` parity for rule-only AST sensors and added stable JSON proposal
  verdicts across accepted and rejected CLI paths.
- Restricted `/hivelore remember` persistence to trusted repository members, made filenames
  collision-safe, regression-tested event authorization and existing-PR idempotence, and now commit
  the action bundle that release refs execute.
- Made `post_task.files_touched` protocol-compatible, bounded manual-session prevention receipts,
  and stopped eval/selftest probes from inflating real prevention outcomes.
- Added a fail-closed, real-embeddings semantic eval lane with its own committed baseline and CI model cache.
- Restored the documented optional semantic layer: base CLI/MCP installs no longer pull the heavy
  embeddings runtime transitively, while dynamic lexical fallback remains functional.
- Added active-MCP runtime version diagnostics, canonical indexing commands, Node 20 package engines,
  quieter actionable-only doctor output, auditable sensor-weakening approvals, and a ten-case
  independently-attested paired benchmark contract.


## [0.43.2]

- Made committed eval baselines portable: authored retrieval now ranks only shared team/module
  memories with deterministic anchor/lexical scoring, independent of personal usage and embeddings caches.
- Anchored benchmark and nested-reference policies to files present in clean clones, eliminating
  false stale-memory enforcement failures in CI.
- Documented and regression-tested sensor-weakening detection so a newly created discriminating
  sensor with `absent` is not misclassified as a suppression broadening.


## [0.43.1]

- Completed bootstrap coverage for the benchmark fixtures, nested Engram reference checkout, and
  GitHub Action with focused module contexts and anchored team knowledge.
- Added validated block sensors preventing unsupported benchmark superiority claims, Engram secret
  leakage, and execution of untrusted GitHub review text.
- Restored the strict finish gate after the new code-map exposed previously uncovered top-level areas.


## [0.43.0] — harness assurance: proven behaviour, structural rules, and review learning persistence

### Security
- Replaced shell-interpolated Git operations in prove-RED and HEAD-baseline reads with
  `execFileSync` argument arrays; hostile refs/paths can no longer trigger shell expansion.
- Blocking shell/test sensors now require a replayed pre-fix ref and persist `red_proven: true`.

### Added
- Full ast-grep Rule objects (`kind`, `inside`, `has`, `not`, `all`, `any`, …), explicit language
  selection, and optional Python/Go/Rust/Java parsers on the existing AST sensor surface.
- Strict policies for unrunnable command sensors and sensor weakening; this repo enables both.
- `/hivelore remember` can persist a proposed team memory on a dedicated review PR. Both review
  comments and top-level PR comments are ingested, and each learning proposes a golden eval case.
- `pnpm verify` is the build-first release chain: build, typecheck, tests, artifact verification,
  authored-case regression gate, and 100% deterministic sensor catch rate.
- Three dogfood guards: shell-interpolation AST protection plus RED-proven CI/verify command sensors.
- Benchmark evidence grading requires at least ten paired tasks with correctness, policy,
  duration, and token outcomes before comparative claims are marked decision-ready.

### Changed
- Eval baselines now store and compare the independently authored report when available instead of
  allowing self-synthesized corpus growth to create or hide regressions.
- CI runs the regression gate and requires 100% sensor catch rate.
- Sensor promotion refuses command/test oracles that have not proven RED.

### Fixed
- Prevention receipts treat legacy missing `prevented_count` values as zero instead of emitting
  `prevented_count_total: null`.
- Retired the obsolete separate-global-MCP lesson and refreshed active package sensors for the
  `@hivelore/*` namespace.


## [0.42.1] — eval that would have caught our own bugs (excellence plan, Phase 5)

> The self-synthesized eval scored 100/100 while the stack-pack ranking bug shipped. Golden cases
> now come from reality (gate misses), and a ranking tier CONTRACT guards the classifier's designed
> behavior in every repo's CI.

### Added
- **Gate misses propose golden eval cases.** When `sync` turns a revert of a gate-passed commit
  into a gate-miss lesson, it now ALSO appends a labeled retrieval case (task = the lesson's
  heading, expected = the lesson id) to `.ai/eval/spec.json` under `proposed_retrieval` — never
  scored until a human runs **`hivelore eval --approve-cases`**. Eval reports waiting cases out
  loud; approval is idempotent. (Core: `appendProposedRetrievalCases`, `approveProposedCases`.)
- **Ranking tier contract in every eval run** (`runTierContract`, core): the designed tier per
  memory category under fixed evidence — stack-pack rescue stays alive on strong evidence, the
  weak-evidence crowding guard stays, env workarounds keep the hard cap, anchors always win,
  negative knowledge ranks first. A violated check fails the eval run (exit non-zero) — this is
  exactly the family that would have caught the dead-escape-hatch ranking bug before release.

## [0.42.0] — the PR loop: review replies become proposed lessons (excellence plan, Phase 3)

> The git-native version of CodeRabbit's "Learnings" — with the step no inferential reviewer can
> take: a review learning can graduate into a deterministic blocking sensor.

### Added
- **`hivelore ingest --from github-pr <number|url|comments.json>`.** Pulls a PR's review-thread
  comments (via `gh api`, or a recorded JSON for offline/CI) and keeps HUMAN instructions —
  imperative shapes ("never/always/must/prefer/instead of") or the explicit
  `/hivelore remember` marker; bots, questions, and "LGTM" are dropped. Each kept thread becomes a
  `proposed` **convention** tagged `review-learning`, anchored to the thread's file, carrying PR/
  author/URL provenance, deduped per thread via the existing `ingest:` topic (idempotent re-runs;
  the latest reply in a thread wins). Pure converter in core (`extractReviewLearnings`,
  `reviewLearningsToDrafts`).
- **GitHub Action: `/hivelore remember` ack.** On `pull_request_review_comment` / `issue_comment`
  events, a reply starting with `/hivelore remember <rule>` gets an acknowledgment comment (the
  "learning captured" moment) with the ready-to-run `ingest --from github-pr` command. The Action
  never commits to the repo — persisting stays a deliberate, reviewable local step.

## [0.41.0] — passive capture: failures distill into proposed lessons (excellence plan, Phase 2)

> The claude-mem pipeline shape, finished on our own infra: the PostToolUse hook already observed
> failures; now `session end --auto` turns them into REVIEWABLE corpus candidates — no agent
> discipline required, no LLM, no new surface.

### Added
- **Auto-captured lesson drafts.** `session end --auto` (the SessionEnd hook path) clusters the
  session's failure observations (`distillFailureObservations`, core: retries collapse, exploratory
  lookups dropped, capped at 3/session) and writes each as a `proposed` **attempt** tagged
  `auto-captured`, anchored to the observed files, deduped against existing attempts and across
  re-runs. Boundaries: deterministic templating only, born `proposed` (never validated), never a
  sensor; autopilot's 72h time-based auto-approve explicitly SKIPS `auto-captured` drafts.
- **The nag now points at the drafts.** `uncaptured-failures` (enforce finish) and the auto-recap's
  discoveries list the waiting drafts ("review/approve or reject") instead of asking the agent to
  re-type what the harness already observed.
- **Hook-less agents feed the same stream.** `hivelore run --` records a failure observation when
  the wrapped agent exits non-zero, so wrapper-mode sessions distill too.

## [0.40.0] — AST sensors: structural precision via ast-grep (excellence plan, Phase 1)

> Reuse over build: the industry-best static rule mechanism (ast-grep structural patterns) becomes a
> sensor kind, while everything that makes Hivelore unique — provenance + deterministic validation —
> stays. The regex engine remains the dependency-free default.

### Added
- **`kind: ast` sensors** (`sensors propose --kind ast --pattern '<ast-grep pattern>'`,
  `propose_sensor kind:"ast"`). Structural matching on the AST of changed files: comments and string
  literals can never false-positive (the regex engine's known weakness), `absent` is checked INSIDE
  the matched node (structural sub-pattern, text fallback for property keys). Fires only when a
  match intersects the diff's added lines — introduction, not presence (`addedLineNumbersFromDiff`
  in core). Validation transposes unchanged: silent-on-current (HEAD), fires-on-bad-example,
  anti-brittleness; a block proposal is rejected when the engine is missing (`ast-engine-missing`) —
  an unvalidatable guard must not claim to block.
- **Optional engine, honest degradation.** `@ast-grep/napi` ships as an optionalDependency
  (cli + mcp, tsup externals per the documented gotcha). Without it: gate warns
  `ast-sensor-unrunnable` (never blocks), `sensors check` reports the count, doctor says how to
  install (`ast-engine-missing`). TS/TSX/JS built in; other languages via `@ast-grep/lang-*`.

## [0.39.3] — behaviour hardening: prove the RED, contain the execution (excellence plan, Phase 4)

### Added
- **Prove-RED arming** (`sensors propose --red-ref <ref>` / `propose_sensor red_ref`). GREEN on the
  current tree cannot distinguish "the test catches the incident" from "the test passes on
  everything". `red_ref` (the pre-fix commit) is replayed in a scratch `git worktree` (main tree's
  `node_modules` symlinked in) and the oracle must FAIL there. Success records `red_proven: true`
  on the sensor and shows `✓ RED-proven` in the prevention receipt; a block proposal whose oracle
  passes on the incident state is rejected (`red-not-proven`), an unrunnable replay proves nothing
  (`red-unrunnable`), a bad ref is `red-ref-invalid`. Without `red_ref`, behavior is unchanged —
  the acceptance guidance now suggests it.

### Changed
- **Command sensors run env-scrubbed** (gate executor + validation): a repo-authored oracle gets a
  test-runner environment (PATH/HOME/locale/TMP/CI + `NODE_*`/`npm_*`/`NVM_*`/`LC_*`/`HIVELORE_*`),
  not the caller's credentials — cloud keys and tokens are no longer visible to sensor commands.
  Pure allowlist in core (`scrubbedCommandEnv`).

## [0.39.2] — stack-pack seeds rank when the task is squarely theirs

> Root-caused from the v0.39.1 gauntlet: on a freshly seeded Nest+Next+Prisma repo, the task
> "add a prisma migration" left `prisma-migrations-never-modify` in `background`
> (briefing thin, useful=0) — the single most relevant lesson hidden by its own origin tag.

### Fixed
- **Stack-pack rescue on strong task evidence.** The briefing down-rank that keeps generic seeds
  from crowding out repo-specific knowledge had a dead escape hatch: it only lifted seeds with a
  direct anchor, but stack packs ship anchor-less (`needs_anchor`), so they could NEVER rank above
  background. In the shared classifier (`classifyMemoryPriority`, one source of truth for CLI and
  MCP), a stack seed with an **exact/literal task hit or strong semantic relevance (cosine ≥ 0.65)**
  now ranks `useful` — never `must_read`. Weak evidence (tag hits, mid semantic) is still smothered,
  and env-workaround memories keep the unconditional cap. Threshold calibrated on live scores: the
  on-topic pack memory measured 0.688–0.755 vs ≤ 0.60 for off-topic neighbours.

> Fixes from a full gauntlet of the installed v0.39.0 — no new surface, the existing one made truthful.

### Fixed
- **A pending oracle can no longer arm a block sensor** (`oracle-pending` rejection). A scaffolded
  stub (`it.todo`/skip) passes on anything, so `sensors propose --kind test` used to accept it and
  report protection that enforced nothing. `propose_sensor` now extracts the test files referenced
  by the command and rejects a `block` proposal while any is still pending; `warn` is accepted with
  an explicit pending-stub note. (Core: `hasPendingTestMarker`, `extractTestFilePathsFromCommand`.)
- **Bootstrap gate now credits glob-scoped BLOCK sensors.** Stack packs ship anchor-less memories
  with glob sensor scopes (`**/*.controller.ts`), so `init` reported "N sensors active" while the
  bootstrap checklist claimed the same areas had "no guardrail". A validated block sensor whose
  scope matches an area's files now closes that area's `sensor-coverage` gap; warn sensors still
  don't count (they cannot block a repeat).
- **Doctor output polish**: the trailing command list is now titled "Suggested commands" (it
  duplicated the "Next actions" findings header), and prose fixes are prefixed `→` instead of a
  misleading shell `$`.
- **`mem_tried` slug hygiene**: the permanent id can no longer end on a connective after the 5-word
  cut (`…-contract-drift-between-api-and` → `…-contract-drift-between-api`).

## [0.39.0] — gate-surface integrity + behaviour-loop accounting

> Six hardening steps from a full harness audit: the gate now watches its own surface (a diff that
> weakens a sensor is called out), never fails dark, explains its score, keeps enforced lessons
> team-scoped, nudges open behaviour loops closed, and scaffolds multi-package lessons properly.

### Added
- **`sensor-weakened` review finding** (`enforce check` / `ci`, all `antiPatternGate` modes incl.
  `off`). The gate lives in `.ai/` — the same tree the agent it constrains can edit. A staged diff
  that demotes a block sensor to warn, changes/removes its oracle (`pattern`/`command`), broadens
  its `absent` suppression, deletes the sensor block, or deletes a memory carrying a block sensor
  now surfaces a warn finding naming each change. Review-only, never blocks (legitimate demotions
  exist); removing `absent` TIGHTENS a sensor and never flags. Pure detector:
  `detectSensorWeakening` in `@hivelore/core`.
- **`post-incident-test-unarmed` nudge** (doctor + `enforce finish`, warn, zero score impact). A
  scaffolded post-incident test whose assertion is still pending (`it.todo`/skip), or whose lesson
  has no armed shell/test sensor, is an OPEN behaviour loop — the incident is documented but nothing
  deterministic guards it. Cross-checked via the scaffold's provenance marker
  (`assessScaffoldLoop` in core; collector scans `incidents/` directories).
- **Multi-package scaffolds.** A lesson whose anchors span several packages now scaffolds **one
  pending test per owning package** (framework and location per package) instead of "first anchor
  wins" — in both `hivelore sensors scaffold` and the `scaffold_test` MCP tool (new `scaffolds[]`
  in the output). A memory carries ONE sensor, so all generated tests share a single
  `propose_command` whose oracle chains every run command (`… && …`).

### Changed
- **Enforced lessons default to team scope.** `mem_tried` with a one-shot `sensor` (MCP and
  `hivelore memory tried --sensor-*`) now defaults `scope` to **team** instead of personal: a
  sensor on a personal (gitignored) memory only guards the machine that captured it. An explicit
  scope always wins. `propose_sensor` additionally nudges promotion whenever an accepted sensor
  lands on a personal memory.
- **The enforcement score names its top penalties.** `enforcement-score-below-threshold` now reads
  `… below required threshold 85% — top penalties: sensor-block (−45), …` instead of an unexplained
  percentage.
- **The sensor gate never fails dark.** An internal error in the gate's sensor machinery used to
  silently skip ALL sensors (fail-open); it now emits a `sensor-gate-errored` warn finding saying
  protection is off until fixed — still never blocks a commit on harness breakage.

## [0.38.0] — scaffold_test MCP tool + monorepo-aware framework detection

> Two follow-ups to post-incident scaffolding: agents can scaffold in-session, and detection is
> monorepo-aware.

### Added
- **`scaffold_test` MCP tool** (enforcement profile). The in-session mirror of `hivelore sensors
  scaffold`: an agent goes from a captured lesson to a pending post-incident test without leaving the
  conversation. Writes the stub (or previews with `write: false`), returns `run_command` +
  `propose_command`, refuses to clobber an existing file, and — like the CLI — **never arms a
  sensor** (`propose_sensor` stays the sole validated writer).

### Changed
- **Monorepo-aware framework detection.** Scaffolding now detects the test framework and file
  location from the package that OWNS the lesson's anchor paths, not the repo root: a lesson under
  `packages/api/` scaffolds a test into `packages/api/tests/incidents/…` using that package's
  framework. `detectTestFrameworkForPaths` walks up from each anchor path to the nearest enclosing
  manifest (`package.json` / `go.mod` / a python signal).
- **Single shared detector.** Framework detection is now one implementation: the pure decision
  (`pickTestFramework` / `normalizeFramework`) lives in `@hivelore/core`, the FS walking in
  `@hivelore/mcp`, and the CLI imports it — removing the CLI's duplicate detector.


## [0.37.0] — post-incident test scaffolding — mem_tried → sensors scaffold → command sensor

> The behaviour bridge's on-ramp. A command sensor needs a test to route as its oracle — and someone
> has to write it. This release generates that test from the lesson, closing the loop
> `mem_tried → sensors scaffold → (write assertion) → propose --kind test`.

### Added
- **`hivelore sensors scaffold <memory-id>`.** Turns an attempt/gotcha lesson into a PENDING test
  file the team fills in, then arms as a command-sensor oracle. It:
  - detects the repo's test framework (vitest / jest / pytest / go; `--framework` to override),
  - writes a stub whose header carries the incident's provenance (memory id, incident, why, expected),
    with the test left pending (`it.todo` / `@pytest.mark.skip` / `t.Skip`) so the suite stays green
    until you write the assertion,
  - prints the exact `sensors propose --kind test --command "<runner> <path>"` line to arm it.
  - `--out` / `--stdout` / `--force` for placement and preview; refuses to clobber an existing file.
- The generator (`scaffoldPostIncidentTest`, `parseLessonFields`, `lessonShortName` in
  `@hivelore/core`) is pure and unit-tested; the CLI owns framework detection and file writing.

### Changed
- **`hivelore memory tried` nudges toward a real test.** When a regex can't express the mistake, the
  output points to `sensors scaffold <id>` as the behaviour-bridge path.

### Notes
- Scaffolding **never arms a sensor** — `propose_sensor` stays the sole validated writer (silent on
  current code, fires on the bad example). The stub is deliberately pending so an empty test can't
  masquerade as a passing oracle.


## [0.36.0] — positioning: enforcement-first top-line, incident→test provenance, shareable receipt, cold-repo gate headline

> A positioning-driven release: sharpen the wedge (Hivelore is the deterministic policy gate, not a
> memory layer), push the behaviour-harness story forward (link a lesson to the incident its test
> guards), make the prevention receipt a growth loop, and fix the cold-repo first impression.

### Added
- **Incident provenance on sensors (behaviour-harness increment).** A sensor can carry an optional
  `incident` ref (ticket / prod id). It surfaces at the gate (`↩ guards incident: prod #442`) and in
  the prevention receipt (`↩ incident: …`), turning "a test failed" into "this reproduces the
  incident the test exists to prevent" — the link a plain CI test can't express. Set it via
  `hivelore sensors propose --incident`, `propose_sensor`, or the `mem_tried` sensor block. Provenance
  lives on the committed sensor frontmatter (team truth); the receipt derives it by lookup, so
  `PreventionEvent` is unchanged and old logs stay valid.
- **`hivelore stats receipt --share`.** Emits a Markdown block ready to paste into Slack or a PR —
  incident provenance included, plus a subtle Hivelore attribution footer so shared proof markets the
  tool. An empty window renders a forward CTA (turn a past incident into a guardrail) instead of a
  dead zero, so the receipt is useful on day one. The CI PR comment carries the same attribution.

### Changed
- **Positioning leads with enforcement.** The README top-line, CLI root description, and package
  descriptions now lead with "the deterministic policy gate for agent-written code"; memory is framed
  as the substrate, not the pitch — differentiating from the crowded agent-memory market where no tool
  enforces.
- **Blocked-gate output leads with a headline.** `enforce check` now says WHY it blocked in one line:
  a content catch (`sensor-block` / `precommit-policy-block`) → "🛡️ A documented lesson refused this
  commit — about the change you just made" (naming the memory id); only setup/baseline gates → "⚙
  Setup gate — about your repo's baseline, not the change you just made." Fixes the cold-repo first
  impression where a real sensor block was buried among bootstrap/score noise.


## [0.35.1] — quarantine keeps its promise — promoted_at, durable gate-miss drafts

> Verification pass on 0.35.0 (review + fresh e2e on sandbox repos). The three features work as
> specced; three defects found at the seams, all fixed here.

### Fixed
- **`sensors promote` actually ends a quarantine.** Promoting a fixed oracle back to `block` was a
  no-op: the pre-promotion flaps were still inside the 30-day ledger window, so the next commit
  re-flagged `sensor-flaky` and the next `sync` re-demoted to warn — for up to 30 days. The sensor
  now records `promoted_at` on promotion and health assessment (gate, sensors check, sync, doctor)
  ignores evaluations at or before it. New flaps after promotion still quarantine normally.
- **Gate-miss drafts no longer eat themselves.** Drafts were anchored to the REVERT commit's file
  list — including files the revert just deleted and `.ai/` corpus files — so the very next `sync`
  marked them stale (invisible to doctor and briefings). Anchor candidates now exclude `.ai/` and
  paths that no longer exist on disk; a draft with no surviving path stays unanchored.
- **Gate-miss sensor hints are no longer shared junk.** The seed was extracted from the draft's own
  boilerplate ("Subject:", the generated why_failed sentence), producing the same useless pattern
  for every draft. It is now derived from the commit subject only, falling back to the honest
  "inspect the revert diff" text.


## [0.35.0] — the self-auditing gate — flaky quarantine, prevention receipts, gate-miss drafts

Hivelore's gate now audits its own reliability, learns deterministically from misses, and makes its
prevented-work value visible. All runtime evidence stays local under `.ai/.runtime/`; only reviewed
conclusions change the shared corpus.

### Sensor trust
- **Rolling sensor evaluation ledger.** Every regex/shell/test evaluation records fired, silent, or
  unrunnable outcome, stage, HEAD, duration/exit code, and a SHA-256 of scoped file contents. The
  best-effort NDJSON ledger rolls from 10,000 to the newest 8,000 rows and can never break a commit.
- **Flaky command sensors quarantine themselves.** Two fired↔silent transitions on identical scoped
  content within 30 days immediately downgrade a block to warn in memory; `hivelore sync` persists
  the demotion and one idempotent quarantine note. `doctor`/the gate show `sensor-flaky`; 20+ silent
  evaluations across 30+ days show `sensor-never-fired`. Manual `sensors promote` clears quarantine.

### Prevention receipts
- **`hivelore stats receipt [--since 7d] [--json]`.** Aggregates the prevention event log, usage
  counters, memory titles, sensor metadata, and current-vs-previous window trend into Slack-ready
  text or a stable JSON object.
- **One PR receipt comment.** Generated enforcement workflows capture this run's sensor findings,
  always upsert `<!-- haive:prevention-receipt -->` on pull requests, show the weekly totals, and
  silently skip when the token, PR permissions, or `gh` are unavailable. The original gate status
  is restored after commenting, so reporting never masks a failure.

### Gate-miss learning loop
- **Incremental git watch during `hivelore sync`.** The first run initializes at HEAD; later syncs
  scan only the saved SHA..HEAD range for existing deterministic revert/hotfix signals. Each new
  signal creates one deduplicated `status: proposed`, `gate-miss` lesson with commit/path provenance.
- **Gate-pass cross-reference.** Successful pre-commit/CI runs write a synthetic local ledger row.
  Reverting one of those SHAs annotates the draft that the gate passed it and includes a
  `proposed_sensor_seed` hint; nothing is auto-validated or auto-blocking. `doctor` lists pending
  gate-miss drafts for human review.

### Tests
- Added pure ledger/flap/window/receipt/git-watch tests plus CLI E2E coverage for alternating
  command-oracle quarantine and re-promotion, receipt aggregation/workflow generation, and the full
  pass-A → revert-B → one proposed gate-miss → idempotent second-sync loop.


## [0.34.1] — typecheck fix for the first-hour release

- Fix a `tsc --noEmit` error in the 0.34.0 init report initializer (`bridgeTargets: []` inferred as
  `never[]`). Runtime behavior unchanged; 0.34.0's CI was red on type-check only. Publish this one.


## [0.34.0] — the first hour — init that respects your machine, your stack, and your readme

> Field-tested the published package on fresh clones of express and vite. The gate engine held;
> every defect found was in the first hour of a new user's experience. This release fixes all of them.

### Changed
- **Bridges: generate for the agents you actually use.** `hivelore init` default moved from all 12
  bridge files to `--bridge-targets auto`: clients detected via machine signals (`~/.claude`,
  `~/.cursor`, `~/.gemini`, `~/.continue`, windsurf/zed/aider configs, VS Code extensions for
  copilot/cline/roo/cody), the currently-running agent's env vars, and bridge files already in the
  repo — plus AGENTS.md always (the cross-tool standard). On a typical machine that is ~5 files at
  the repo root instead of 14. `--bridge-targets all` restores the old behavior; the Cursor MCP
  nudge rule is only written when cursor is a target. The init report lists the actual targets.
- **Stack detection ignores fixture universes.** Nested-manifest scanning skips
  playground/examples/fixtures/e2e/demo/bench/sandbox dirs, `template-*`-style scaffolding families,
  and doc sites (docs/website — VitePress→vue, Docusaurus→react are the docs' stack, not the
  product's). On the vite repo this cuts seeding from 6 irrelevant stacks (react, vue, tailwind,
  express…) to exactly vite + typescript. Real monorepos (apps/web with next, apps/api with nest)
  still detect fully.
- **Stack-pack seeds are never auto-anchored.** The corpus auto-fix matched export names against
  generic seed prose and anchored a React useEffect gotcha to a docs data file on a non-React repo.
  Seeds now stay unanchored/background until someone anchors them deliberately; normal memories keep
  the auto-anchor fix.

### Fixed
- **The first suggested command works now.** init's closing hint printed
  `hivelore memory import README.md` — missing the required `--from`, blind to the file's actual
  casing (express ships `Readme.md`), and printed even when no readme exists. init and the
  bootstrap template now detect the real filename case-insensitively, print
  `memory import --from <file> --changelog` (direct, no AI) vs `--from <file>` (AI-client prompt)
  honestly, and stay silent when the file is absent. Same fix for the bootstrap README excerpt.
- **Corrupt memory files are no longer silently invisible.** A memory with broken frontmatter was
  skipped without any signal — a lost team lesson. `loadMemoriesFromDirDetailed` (core) reports
  parse failures and `hivelore doctor` surfaces them as `invalid-memory-files` (warn) with the path
  and the YAML error.
- **Stale references to removed surface.** doctor and get_briefing hints no longer recommend
  `mem_observe` (removed in 0.32.0); the runtime README no longer mentions `runtime_journal_append`;
  doctor's stale-memory fix no longer suggests the removed `memory edit`.
- **One code-map option set.** autopilot repair and `index code` hand-rolled shorter exclude lists
  (re-including test dirs) than init/sync; all callers now extend the exported
  `CODE_MAP_DEFAULT_EXCLUDE` baseline, so successive code-maps agree on which files exist.

### Tests
- +11 tests (684 total): findDocFile casing, bridge detection (machine/env/repo-file signals, bare-
  machine fallback), seed non-anchoring vs normal-memory anchoring, detailed loader on corrupt files.


## [0.33.0] — the behaviour bridge — command sensors route your own tests to lessons

> The three-harness table said "Behaviour: ⛔ out of scope". This release moves it to 🟡 Bridged —
> without touching the oracle problem: Hivelore does not generate tests or judge outputs, it routes
> the oracle the team ALREADY OWNS (an existing test, an invariant script) to the lesson it protects,
> and the gate executes it deterministically. Verified e2e: a pure behaviour bug (clean code no regex
> can see) is refused at commit with the oracle's output in the finding.

#### Added
- **One-shot behaviour capture**: `hivelore memory tried --sensor-command "npx vitest run …"`
  (MCP: `mem_tried` with `sensor.kind: "shell"|"test"` + `command` + `timeout_ms`) — lesson and
  executable oracle attached in a single call.
- **`propose_sensor` / `sensors propose --kind shell|test --command …`**: command proposals are
  validated before being trusted — the oracle must PASS on the presumed-correct current tree
  (`fails-on-current` rejection), and an unrunnable command is its own rejection reason.
- **Shared executor** (`utils/command-sensors.ts`): per-sensor `timeout_ms` (default 120s), output
  tail captured into findings, and the critical distinction — a command that RAN and failed enforces
  at the sensor's severity; an UNRUNNABLE command (127/126/timeout) surfaces as
  `command-sensor-unrunnable` (warn) and never blocks: a broken harness must not masquerade as a
  failing test. Wired into the gate (pre-commit + CI) and `sensors check --commands`.
- Gate findings now show the failing oracle's exit code, duration, and output tail — the agent sees
  WHICH assertion broke without re-running anything.

#### Unchanged (the honesty rules)
- Command execution stays **opt-in per repo** (`enforcement.runCommandSensors: true`) — it runs
  repo-authored commands and is never enabled globally by Hivelore.
- No test generation, no sandbox platform, no LLM-as-judge: full behaviour verification remains the
  test suite's job. README three-harness table updated (⛔ → 🟡 Bridged).


## [0.32.0] — surface reduction — 67→55 command files, one verb per job

> Field verdict after weeks of dogfooding: the surface had outgrown a solo maintainer. Everything
> a daily user needs stays; duplicates and the unused long tail go. All old spellings keep working
> as hidden aliases — nothing breaks, the help just stops advertising two names for one job.

#### Removed (unused / off-mission; resurrect from git history if ever needed)
- CLI: `snapshot` (API-contract snapshots — behaviour-harness territory, explicitly out of scope),
  `playback`, `welcome`, `hub`, `tui` (the ink/react interactive dashboard — `dashboard`/`stats`
  cover it; drops ink+react from the CLI bundle), `runtime journal`.
- MCP experimental tools: `mem_observe`, `why_this_file`, `why_this_decision`, `mem_conflicts_with`,
  `pattern_detect`, `runtime_journal_append/tail` — usage logs showed ONE call across all of them
  in two months. `HAIVE_TOOL_PROFILE=experimental`/`full` remain as aliases of `maintenance`.

#### Merged (one verb per job; old names = hidden aliases)
- `install-hooks` → **`enforce install`** (single hook generator at last: pre-commit, pre-push,
  commit-msg + post-merge/post-rewrite sync; `--claude-scope`, `--claude-settings`, `--remove-claude`).
- `memory import-changelog` → `memory import --changelog [--package --versions]`.
- `memory seed-git` → `memory seed --git [--apply --limit --days]`.
- `memory hot` → `memory stats --hot [--threshold]`; `memory timeline` removed (MCP `mem_timeline` remains).
- `memory suggest-topic` → `memory suggest --topic <title> --type <type>`.
- `memory edit` → `memory update <id> --edit [-e <editor>]`.
- `memory conflict-candidates` + `memory resolve-conflict` → **`memory conflicts [<a> <b>] [--yes]`**.
- `memory pending` → `memory list --pending`.
- `memory for-files` and `memory auto-promote` removed (`briefing --files` and `sync` cover them).
- `embeddings index|query|status` → **`index memories|query|status`** next to `index code`
  (hidden `embeddings` family alias kept).

Net: 67 → 55 command files (−3,358 net lines), root commands 38 → 31, `memory` subcommands 31 → 20,
MCP tools 37 → 30, CLI bundle sheds ink/react. File formats, hooks contracts, VS Code extension
calls, and the MCP enforcement profile are untouched.


## [0.31.0] — kill the rituals — one-shot guardrails, release verbs, fatigue guard, token diet

> Driven by multi-session dogfooding ("what would make Hivelore irresistible"): remove the
> ceremonies a daily user repeats, stop warning fatigue before it teaches people to skim,
> and cut briefing token cost. A scan of awesome-harness-engineering confirmed the direction
> (half the ecosystem is token-reduction; nobody else closes the lesson→enforcement loop).

#### Added
- **One-shot loop close**: `mem_tried` accepts a `sensor` parameter (pattern/absent/severity/
  bad_example) that runs the full propose_sensor validation inline — capture the lesson AND
  attach the validated guardrail in a single call. CLI: `memory tried --sensor-pattern …
  [--sensor-absent … --sensor-severity block --bad-example …]`. The CLI command now delegates
  to the shared mem_tried handler (killed a 60-line duplication).
- **`hivelore release bump <patch|minor|major|X.Y.Z>`** — lockstep-bumps the 5 publishable
  manifests + scaffolds the CHANGELOG section; **`hivelore release tag`** — verifies lockstep +
  clean tree + not-already-tagged, creates `vX.Y.Z`, pushes branch and that one tag.
- **`enforce finish --wait [--wait-timeout N]`** — polls GitHub Actions for HEAD instead of
  failing on pending CI (replaces the manual `gh run watch` loop in the exit protocol).
- **Repeat-warning fatigue guard**: the aggregated `anti-pattern-review` finding lists only ids
  NOT shown in the last 24h; repeats collapse into "+N shown recently" (runtime-local debounce,
  count unchanged, `hivelore precommit` still lists everything).
- **Briefing token diet**: in `get_briefing` (format full), `background` memories ship as
  one-line pointers (`mem_get(id)` away) whenever the briefing has direct hits — a cold-start
  briefing dropped from ~3.7k to ~1.4k tokens in the field test. Thin briefings keep full bodies.
- **Near-duplicate hint on re-seed**: `init` warns when a seeded stack lesson likely duplicates
  an existing hand-written memory (points at `memory conflict-candidates` / `resolve-conflict`).
- Cold-start feedback: the first briefing on a large repo announces the one-time semantic code
  index build on stderr instead of silently hanging ~40s.

#### Fixed
- **Glob sensor scopes were silently dead** (`sensorAppliesToPath` did pure prefix matching):
  every `**/*.controller.ts`-style pack sensor never fired anywhere. Glob scopes now match.
- **Seeded stack sensors are pinned repo-wide (`["**"]`)**: the memory-anchor fallback was
  silently narrowing stack-wide rules ("never `$disconnect()` in serverless") to the single
  exemplar file the seed got anchored to.
- **CLI/MCP parity**: `hivelore briefing` now infers modules and loads module contexts like the
  MCP `get_briefing` (the CLI JSON omitted them entirely — module rules never reached CLI flows).
- `doctor` on an uninitialized directory prints a clear message instead of meaningless health scores.
- Retired the obsolete high-max-memories briefing ritual: the gotcha memory documenting it now
  says autoBrief covers it, and its sensor (which nagged every diff mentioning "decision-coverage"
  with outdated advice) was removed.


## [0.30.1] — process gates bind agents, not humans

> Field feedback from the 0.30.0 test pass: `briefing-missing` blocked a HUMAN committing by hand.
> The process gates encode the agent workflow contract ("consult team knowledge before changing
> code"); a human is the trusted author of that knowledge.

#### Added
- **Agent-context detection** (`detectAgentContext`, @hivelore/core): identifies agent harnesses
  from the environment (Claude Code, Cursor, Gemini CLI, Codex, Aider, the `hivelore run` wrapper
  via `HAIVE_SESSION_ID`/`HAIVE_AGENT=1`); `HAIVE_AGENT=0` force-overrides to human.
- **`enforcement.humanCommits: "relaxed" | "strict"`** (default `relaxed`): when no agent harness
  is detected at pre-commit/pre-push, the PROCESS gates (briefing-missing, session-recap-missing,
  decision-coverage-missing, bootstrap-incomplete) downgrade to warnings with an explanatory note.
  DETERMINISTIC gates (block sensors, anti-pattern blocks, stale anchors, artifact hygiene) still
  bind everyone, and CI is unaffected. The gate header now names the actor:
  `strict · agent (claude-code)` vs `strict · human — process gates relaxed`.

Verified: human clean commit without briefing → passes with a warning; human reintroducing a
sensor-blocked pattern → still refused (exit 2); agent (Claude Code detected) without briefing →
still refused (exit 2).

## [0.30.0] — hAIve is now Hivelore

> One name everywhere: the brand, the binary, the npm scope, and the GitHub repo are now
> **Hivelore** (`hivelore`, `@hivelore/*`, `github.com/Doucs91/hivelore`). The old naming had
> three spellings (hAIve / @hiveai / haive) and two live collisions (HaiVE.tech, Hive AI /
> thehive.ai); `haive.dev`/`.ai` and the bare `haive` npm name were already taken.

#### Changed (rename — backwards compatible)
- **npm packages**: `@hiveai/{core,cli,mcp,embeddings}` → `@hivelore/{core,cli,mcp,embeddings}`.
  The `@hiveai/*` packages stay on npm (deprecated, pointing here); no further releases there.
- **Binaries**: the CLI installs `hivelore` (primary) **and** `haive` (legacy alias) — existing
  git hooks, MCP configs, and wrappers that call `haive` keep working unchanged.
  Same for `hivelore-mcp` / `haive-mcp`.
- **MCP**: server identity is `hivelore`; generated client configs write the `"hivelore"` server
  key (an existing `"haive"` key is recognized and left alone at user level; project-level
  configs are upgraded in place). Generated hooks resolve `hivelore` first, then legacy `haive`.
- **VS Code extension**: `hivelore.hivelore-vscode` (settings + commands under `hivelore.*`).
- **Docs**: README repositioned around the one-line promise and a copy-paste
  "60-second proof" that shows a captured lesson refusing a commit.

#### Unchanged (file formats — no migration needed in your repos)
- The `.ai/` directory, `haive.config.json`, `haive-*.yml` workflow names, bridge marker comments
  (`<!-- haive:… -->`), `merge=haive` git driver key, `HAIVE_*` environment variables, and MCP
  tool names all stay as-is. A repo initialized with hAIve works with Hivelore without any change.

#### Migration (only if you want the new names)
1. `npm i -g @hivelore/cli` (replaces the global install; both binaries land on PATH).
2. Optionally rename the `"haive"` key in your MCP client configs to `"hivelore"` and point
   `command` at `hivelore` — or leave it; the alias keeps working.
3. `git remote set-url origin https://github.com/Doucs91/hivelore.git` (the old URL redirects).

## [0.29.13] — deterministic gate: only a validated sensor hard-blocks

> The v0.29.12 release commit passed the local gate at 95% and hard-blocked on GitHub Actions at
> 50% — same diff, same corpus. Root cause: the last non-deterministic block path (sensor-less
> memory + semantic ≥ 0.75) depends on cosine scores that vary per environment (fresh model
> download, runtime, warmup). A gate that answers differently per machine trains agents to bypass
> it — determinism IS the product promise of the feedback layer.

#### Changed
- **Hard-blocking is now sensor-only** (`classifyWarning`, precommit-check.ts): a sensor-less
  memory never blocks, even on a very strong semantic match — it surfaces as `review` with a
  rationale pointing at `propose_sensor`. The anchored gate keeps every other precision rule
  (personal-scope veto, sensor veto, distinctive-token analysis) for review/info tiering.
- **Prevention outcomes are sensor-only too** (`isHardBlockCatch`, anti-patterns-check.ts) — the
  "prevented mistakes" metric only counts what the gate would actually block.
- README "What block means" rewritten around the determinism rule.

#### Fixed
- **`precommit-policy-block` now names the culprits** — blocking memory ids (with reasons and
  sensor severity) and stale-anchor ids are in the finding message and `memory_ids`. The v0.29.12
  CI failure was undebuggable from the workflow log ("1 blocking anti-pattern", no id).

## [0.29.12] — the gate stops swallowing review warnings; sensor proposals validate against HEAD

> From a full end-to-end dogfooding pass on a fresh repo: the commit gate reported a clean pass
> while `hivelore precommit` was showing "you are about to repeat a documented failed approach".
> Review-tier knowledge must be VISIBLE at the gate (without blocking), and closing the
> lesson→sensor loop must work at the exact moment agents actually do it.

#### Fixed
- **`enforce check` now surfaces review-tier anti-patterns** as a single aggregated
  `anti-pattern-review` warn finding (bounded impact 5, never blocks). Previously
  `runPrecommitPolicy` dropped every non-blocking warning from `preCommitCheck`, so the hook/CI
  path reported `precommit-policy-pass` at 100% while an anchored attempt matched the diff.
  Aggregation (not one finding per warning) keeps the score impact bounded — the strict per-warning
  variant is exactly what 2026-05-07-attempt-strict-precommit-gate-on-haive documents as noise.
- **`propose_sensor` / `sensors propose|promote` self-checks now validate against HEAD**, not the
  working tree (new shared `readPresumedCorrectTargets`, exported from `@hivelore/mcp`). The realistic
  sequence — write bad code, hit the failure, `mem_tried`, propose the sensor, THEN revert — was
  impossible: the uncommitted bad pattern made every honest block proposal fail `fires-on-current`.
  HEAD is the last gated (presumed-correct) baseline; non-git dirs and new files fall back to the
  working tree.
- **`pre_commit_check` `affected_files` now points at the anchored code files**, never at
  `.ai/code-map.json` / bridges staged alongside (the repair hint sent agents to the wrong file).
- **`briefing_quality` no longer says `noisy` when a must_read matched**: a direct anchored hit is
  the product working; background-seed domination stays in `reasons`. (MCP + CLI kept in sync.)
- **`memory lint` no longer flags stack-pack seeds with MISSING_ANCHOR** (they carry
  `stack-pack` + `needs_anchor` tags and are unanchorable by nature); first-run output shows real
  findings instead of seed noise.

#### Added
- **CLI flag suggestions**: `showSuggestionAfterError` on the root program (inherited by all
  subcommands) — `--bodi` now answers "Did you mean --body?". Plus hidden synonyms for the two
  flags agents reliably guess: `memory save --content` → `--body`,
  `session end --summary` → `--accomplished` (hidden from help; documented flags stay the API).

## [0.29.0] — agent-proposed sensors (LLM generates, core validates)

> The generation half of "make auto-generation excellent": the agent — which understands the code —
> proposes the sensor; Hivelore refuses to trust it as a block until it proves it discriminates. This
> turns a captured lesson into a RELIABLE block instead of a heuristic guess.

#### Added
- **`propose_sensor` MCP tool** (enforcement profile) + **`hivelore sensors propose` CLI**: the agent
  writes the `pattern` (faulty usage) and an `absent` companion (correct-usage marker); Hivelore validates
  the proposal with `judgeProposedSensor` and only writes it when accepted. A `block` proposal is
  accepted ONLY if it is not brittle, stays SILENT on the current (correct) anchored code, and FIRES
  on the bad example. A rejected proposal is NOT written — the returned `reason`/`guidance` tells the
  agent how to revise and re-propose.
- **core `judgeProposedSensor`**: the pure accept/reject policy behind both façades.
- `mem_tried` now hints the agent to call `propose_sensor` to upgrade the auto-suggested warn sensor
  into a validated block.

#### Principle (completes the auto-generation overhaul)
- Generation is delegated to the LLM-in-the-loop (it understands the code); core's job is to VALIDATE
  and refuse to auto-trust what fails its own check. Recaps (post_task + anchor validation) and context
  (bootstrap_project + grounding, v0.28.5) already follow this; sensors now do too.

Verified end-to-end on a fresh non-Hivelore repo: a broad block proposal is REJECTED (fires on the current
correct code, with guidance to add `absent`); the discriminating proposal is ACCEPTED (silent on
current, fires on the bad example).

## [0.28.5] — self-validating sensors + grounded context (generate → verify → trust)

> Makes the auto-generation layer honest: an auto-artifact is trusted only after it passes a
> deterministic check. A sensor may hard-block only once it proves it discriminates; a generated
> context is flagged when it cites files that don't exist.

#### Added
- **Sensor self-validation** (`sensorSelfCheck`, `extractSensorExamples` in core): before a sensor can
  be promoted to `block`, it must be SILENT on the current (presumed-correct) anchored code and,
  when the lesson carries a bad example, FIRE on it. `hivelore sensors promote --severity block` now
  refuses (without `--force`) a sensor that matches the current code — the false-positive gate that
  trains agents to ignore enforcement. Reports fires-on-bad / silent-on-current.
- **`hivelore doctor` `sensor-fires-on-current`** (Protection): flags block sensors that match the
  current HEAD — they false-positive on every commit and can't be trusted as protection.
- **Context grounding** (`extractReferencedPaths` in core): `hivelore doctor` reports
  `project-context-ungrounded` when a FILLED project-context cites file paths that don't exist on
  disk (the hallucination/staleness failure mode of generated context).

#### Principle
- Generation stays delegated to the LLM-in-the-loop (MCP prompts); core's job is to VALIDATE and
  refuse to auto-trust anything that fails its own check. Verification is the moat, not generation.

Verified end-to-end on a fresh non-Hivelore repo: a broad `console.log` sensor anchored to a file that
currently logs is REFUSED block promotion; the discriminating Stripe-idempotency sensor (silent on the
correct code) is allowed.

## [0.28.4] — discriminating sensors (fire on the faulty call, not every call)

> Closes the gap between the pitch ("blocks the repeat") and reality: autogenerated sensors used to
> match every use of an API (e.g. all `stripe.paymentIntents.create`), so promoting one to block would
> false-positive on correct code. Now they discriminate the faulty usage from the correct one.

#### Added
- **`sensor.absent`** (schema): an optional "correct-usage" regex. When `pattern` (the risky call)
  matches but `absent` also appears in a forward-biased window around the match, the catch is
  SUPPRESSED — the diff already includes the required companion. Encodes "X without Y".
- **Discriminating sensor generation** (`sensor-suggest.ts`): detects a required companion from the
  lesson text — "create **without** an idempotencyKey", "**must pass** an idempotencyKey",
  "missing/forgot/no X" — and emits `pattern`=trigger + `absent`=companion instead of a bare
  API-wide pattern. Message becomes "X without Y — <fix>".
- `hivelore sensors list` shows the companion as `only when missing: <regex>`.

#### Changed
- The `absent` window is forward-biased (lookback 2, forward 6): the required option is part of the
  call's arguments, which follow it — so a *separate* correct call sitting just above a faulty one no
  longer masks the faulty one (a failure caught while dogfooding on a foreign repo).

Verified end-to-end on a fresh non-Hivelore repo: capturing the Stripe-idempotency gotcha auto-generates
`pattern=stripe\.paymentIntents\.create`, `absent=idempotencyKey`; promoted to block, the gate fires on
a `create` call without the key and stays silent on the correct multi-line call beside it.

## [0.28.3] — honesty pass: kill briefing bias, deflate metrics, truthful protection

> Three fixes from dogfooding: stop the corpus from biasing the agent, stop the metrics from
> overstating value, and stop the protection score from outrunning the config.

#### Changed
- **Briefing bias loop broken.** `get_briefing` and the CLI `briefing` no longer auto-surface
  strategy/positioning memories (new config `briefingExcludeTags`, default
  `positioning, competitive, strategy, harness-engineering, roadmap`). They remain fully searchable
  via `mem_search` / `memory search` — only automatic injection is filtered, so the corpus informs
  facts without shaping the agent's opinions on every task.
- **Prevention metric deflated to real blocks.** The anti-pattern gate now records a prevention event
  only for catches that would actually hard-block (a deterministic sensor fired, or a high-confidence
  semantic match ≥ 0.75) — never the re-surfacing of an anchored note that merely shares a word with a
  broad diff. This ends the inflated "N repeats blocked" headline that counted one note matching every
  package.json commit.
- **Eval headline is the independent score.** `hivelore eval` now leads with the authored-only
  (independent ground truth) score; the blended authored+synthesized number is shown as a secondary,
  clearly-labelled self-referential sanity floor — never the headline.
- **Honest protection score.** `hivelore doctor` now reports `sensors-no-hard-block` (Protection) when
  sensors exist but none hard-block — enforcement is advisory, and the score reflects it — with a fix
  to promote a trusted sensor or retire noise.

## [0.28.2] — ephemeral session handoff (NEXT.md) + opt-out of auto recap memories

> Stop the low-signal auto `session_recap` dump from accumulating in — and biasing — the `.ai/`
> corpus, while preserving cross-session continuity via a single overwritten handoff file.

#### Added
- **`NEXT.md` ephemeral session handoff** (`@hivelore/core` `handoff.ts`): on automatic session end,
  Hivelore can write/overwrite one root-level `NEXT.md` (focus + open threads + next steps), meant to be
  gitignored. `buildHandoffMarkdown` / `writeSessionHandoff` / `readSessionHandoff` / `handoffAgeMs`.
- **Config `sessionHandoff`** (default `false`): enable the NEXT.md handoff on auto session end.
- **Config `autoSessionRecap`** (default `true`): when `false`, automatic session end no longer
  persists a `session_recap` MEMORY into the corpus. A manual `hivelore session end --goal ...` is
  unaffected (explicit recaps are always honored).

#### Changed
- `get_briefing` now falls back to surfacing `NEXT.md` as `last_session` when no recap memory exists,
  so continuity survives `autoSessionRecap=false`.
- The `requireSessionRecap` gate is satisfied by a recent `NEXT.md` handoff, not only a recap memory.
- This repo dogfoods the new policy: `autoSessionRecap=false`, `sessionHandoff=true`.

## [0.28.1] — repo cleanup (remove internal research/benchmark artifacts)

#### Removed
- **`docs/`** internal strategy/research/planning/recap documents (battle plan, harness
  coherence map, roadmaps, implementation plans, agent briefs, handoffs) — not user-facing.
- **`benchmarks/`** and **`benchmark-results/`** fixtures + artifacts, the
  `scripts/agent-roi-benchmark.mjs` proxy, and the root `benchmark:roi` package script.
- **`PLAN.md`** historical design doc (superseded by README/CHANGELOG).
- Seven research/positioning recap memories under `.ai/memories/team/` (harness-engineering
  positioning, competitive battle plan, state assessment). Product gotchas/decisions kept.

#### Changed
- Dropped dangling references to the removed docs/scripts from `cli` help text and a code comment.
- No behavioral change to published commands beyond one removed `stats` ROI hint line.

## [0.28.0] — cold-start on real monorepos + auto-publish + corpus hygiene

> Grounded in dogfooding Hivelore cold-start on a real 1.4 GB Next/Nest-style marketplace monorepo.
> The headline finding: on a monorepo with **nested git repos**, `git ls-files` doesn't descend into
> them, so the code-map indexed **2 of 1400+ files — silently**. Fixed and verified (2 → 1232).

#### Fixed
- **code-map now indexes nested git repositories** (monorepos with embedded repos / submodules).
  Previously the parent's `git ls-files` skipped them, leaving the entire code-context layer
  (`code_map`, `code_search`, `symbol_locations`, harness-coverage) near-empty on real monorepos.
  Each nested repo's own `.gitignore` is still respected — no fallback to indexing untracked junk
  (preserves the tracked-files-by-default decision). Verified on a real repo: 2 → 1232 files.
- **Stack detection reads nested package.json** (sub-packages / nested repos), so frameworks that
  live in a sub-package are detected, not just the root manifest (real repo: `react` → `react,
  reactquery, tailwind, vite, typescript`).

#### Added
- **`hivelore doctor` flags a near-empty code-map**: warns when many source files are on disk but few
  are indexed (untracked source, or a structure the indexer can't reach) — previously silent.
  New pure helper `countSourceFilesOnDisk`.
- **`release.yml` GitHub Action**: publishes the four lockstep packages to npm on a version tag,
  gated by the `npm-publish` environment (manual approval) + `NPM_TOKEN`. Closes the gap where a
  tagged release sat unpublished. (Does not change "agents never publish" — it's the human's tag +
  approval + secret.) Verifies the tag matches the package version before publishing.

#### Changed
- **Brittle sensors can never hard-block.** A sensor with a brittle pattern (hardcoded line
  numbers/literals) is downgraded to `warn` at match time even if promoted to `block` — a fragile
  false-positive gate is what trains agents to ignore the gate. `hivelore doctor` now also reports the
  brittle-sensor count under Corpus health.

## [0.27.0] — harness-quality batch: trustworthy sensors, eval honesty, version-aware briefings

#### Added
- **Sensor brittleness lint** (`sensorPatternBrittleness`): high-precision detector for sensors over-fit
  to incident-specific literals (hardcoded line numbers / ranges like `1131-1186`). Digits inside
  character classes/quantifiers (`[0-9]`, `{2,}`) generalize and are never flagged. Wired into:
  `hivelore sensors list` (marks `⚠ brittle` + a count) so dead sensors are visible, not silently counted
  as protection; and `hivelore sensors promote` (refuses to promote a brittle sensor to `block` without
  `--force` — a brittle hard-gate is how false positives train agents to ignore the gate).
- **`server_version`** in the `get_briefing` MCP output, so an agent/human can spot a stale MCP server
  vs the repo in-band (previously only `hivelore doctor` surfaced it).
- **Structured breadcrumbs**: `breadcrumbs.start_here_items[]` — a typed twin of `start_here`
  (`{type,id,scope,file,line,kind,…}`) so agents act without parsing strings. Still pointers, never body copies.
- **`hivelore eval` authored-only score**: when a run blends authored (independent) and synthesized
  (self-referential) cases, the report and `--json` now surface the **authored-only** score separately
  so a flattering 100/100 isn't read as ground truth. Counts authored sensor cases too.

#### Changed
- Sensor autogeneration is more conservative: error/diagnostic words (`unknown`, `exception`,
  `fallback`, …) are stopworded and multi-word prose / error-output fragments (e.g. a backtick span
  `CACError: Unknown option …`) are rejected, killing the residual "dead sensor" class that never
  matched a real diff. (Line-number/file-ref rejection already existed.)

## [0.26.6] — faster repeated search + index staleness transparency

#### Changed
- `Embedder.create()` now caches the fully-initialized embedder per model. The ONNX pipeline was
  already cached, but every `create()` re-ran a "dimension probe" inference — so each `code_search`
  / semantic-search call paid for two inferences instead of one. Repeated searches in a session are
  now materially faster (calls 2..N skip the probe entirely). Behaviour is unchanged.
- `hivelore index code --status` now reports a **freshness verdict**, not just a timestamp: the code-map
  is flagged stale when a file it lists changed after generation, and the code-search index is flagged
  stale when it was built from an older code-map. Verdicts are included in `--json` (`code_map.stale`,
  `code_search_index.stale`) for CI/agents. Cheap — stat-only, no re-walk or re-embedding.

#### Added
- `code_search` MCP tool now returns `stale: true` plus an actionable notice when the embeddings index
  was built from an older code-map, so agents know results may miss newly added/moved symbols instead
  of silently trusting stale hits. New pure helper `isCodeIndexStale` (no false alarms on unknown
  timestamps).

## [0.26.5] — hybrid code_search ranking (exact symbol names first)

#### Changed
- `code_search` / `codeSemanticSearch` now re-ranks results with a small deterministic lexical bonus
  layered on top of the semantic cosine: an exact symbol-name match (+0.30), a partial name-token
  match (up to +0.20, proportional), and a filename-token match (+0.05). This lifts the symbol you
  literally named above merely-similar neighbours — e.g. querying `rebuildCodeIndex` now returns the
  function named `rebuildCodeIndex` first. No new index, model, or dependency; reuses data already in
  the code index entry.
- `min_score` keeps its documented meaning — a pure-semantic noise floor — so the lexical bonus
  re-orders the relevant set without letting incidental filename tokens leak weak hits past the gate.
  Ties break deterministically (score → semantic → file → line) for stable output.

## [0.26.4] — leaner breadcrumbs (map, not manual) + honest token budget

#### Changed
- `get_briefing` breadcrumbs `start_here` is now a terse pointer (priority · id · scope/type · anchor)
  instead of re-summarizing the memory body that already ships in `memories[]`. This removes the
  duplication introduced in 0.26.3 and keeps the default context genuinely small.
- `hivelore briefing` mirrors the same change: the `Start here` block is a pointer list, not a second
  copy of each memory body (the full body still prints below).

#### Fixed
- `get_briefing` now counts the breadcrumbs payload toward `estimated_tokens` and reports it as
  `budget.spent.breadcrumbs`. Previously breadcrumbs were emitted after the token total was computed,
  so the reported budget understated the real wire size.

## [0.26.3] — breadcrumbs-first briefings and cleaner native bridges

#### Added
- MCP `get_briefing` now returns a `breadcrumbs` map with concise `start_here` pointers and
  `drill_down` calls, so agents can keep default context small and pull deeper memories/code only
  when a task needs it.
- `hivelore briefing` prints a `Breadcrumbs` section before full memory bodies, including first-hop
  memory pointers plus optional `mem_get`, `mem_relevant_to`, `code_search`, and `code_map` follow-ups.

#### Changed
- Native bridges now frame Hivelore as a small breadcrumb map and recommend `get_briefing` with
  `budget_preset:"quick"` + `format:"actions"` before drilling deeper.
- Generated native bridges skip `personal` memories so committed agent files do not reference
  gitignored local-only records.

## [0.26.2] — native bridges become non-destructive managed blocks

#### Added
- Native bridge files now carry a full `haive:bridge-start/end` managed block, so Hivelore can refresh
  its generated instructions/memories without owning the whole native file.
- `hivelore bridges status` reports each target as managed, legacy-managed, unmanaged, missing, stale, or
  invalid; `bridges list` remains an alias.

#### Fixed
- `hivelore bridges sync` now skips files with broken or duplicated Hivelore markers instead of appending or
  overwriting ambiguously. Existing human content outside Hivelore markers is preserved.
- `hivelore sync` uses the same bridge writer for existing native bridge files, including `AGENTS.md` and
  `CLAUDE.md`, eliminating drift between the legacy `--inject-bridge` path and native bridge sync.

## [0.26.1] — catch SonarQube stylistic/naming rules in the ingest quality floor

#### Fixed
- SonarQube uses numeric rule keys (`typescript:S103`, `python:S00117`), so the name-based stylistic
  denylist missed them. Added a curated set of Sonar formatting/naming/trivial-maintainability keys
  (S100/S101/S103/S105/S113/S114–S122/S125/S1110/S1116/S1131/S1542), normalized so legacy (`S00117`)
  and modern (`S117`) ids both match. Real security/quality rules (S2068 hard-coded creds, S5852 ReDoS,
  S1234 cognitive complexity) are untouched. Live-verified: `hivelore ingest --from sonar` on 5 findings →
  3 stylistic filtered, 2 security rules kept.

## [0.26.0] — quality floor for ingested findings and git seeds; flaky-test hardening

#### Added
- **Source-appropriate quality gates for the two remaining cold-start sources.** Calibration showed the
  specificity floor is the wrong tool for them (a finding body is always concrete → passes; a git-seed
  body is mostly boilerplate → fails), so each source gets its own gate:
  - **ingest** drops auto-fixable **stylistic** rules (semi/quotes/indent/prefer-const/prettier…),
    matched on the rule's last segment so prefixed ids count. `hivelore ingest --include-stylistic`
    opts back in; the MCP `ingest_findings` tool gains `include_stylistic`. Reports "N low-value/
    stylistic filtered".
  - **seed-git** drops mechanical **noise** subjects (merge/bump/release/deps/wip/format/typo) — a
    reverted merge or dep-bump is not a repo lesson.

#### Fixed
- The embeddings index test is now best-effort — it asserts when the Transformers.js model produced an
  index and never flakes the build when the model is unavailable in CI.

## [0.25.0] — enforce a quality floor on cold-start seeds; framework seeds become sensors

#### Added
- **`meetsSeedQualityFloor` + `SEED_QUALITY_FLOOR` (0.2).** A seed earns its place only if it carries a
  sensor (enforceable) OR is concrete and non-generic — lower than the 0.3 memory-lint bar because seeds
  are background framework reference, not claimed team knowledge. `seed-quality.test.ts` audits the whole
  shipped pack library and fails the build if anyone adds a low-value seed.
- Upgraded the 6 sub-floor seeds with sensors — flask (SQL f-string injection), prisma (`$disconnect`
  in serverless), zustand (whole-store subscribe), nestjs (ORM in controller, scoped to `*.controller.ts`);
  enriched the mongoose `.lean()` note. A fresh Next/Nest/Prisma repo now ships 4 active sensors (was 2).

## [0.24.0] — architecture guard, safe autogen sensors, radar-leak fix, cold-start commands, dashboard value line

#### Added
- **Architecture guard test:** prevention recording MUST funnel through the single shared
  `recordPreventionHits`; the build fails if any source bypasses it (kills the recurring
  "bolted-on entry points" drift that caused two silent leaks).
- **Dashboard "Value" headline:** repeats blocked (30d) · high-impact memories · active policies, with
  an honest "cost is real; payoff is downstream" note.

#### Changed
- **Cold-start:** the minimal auto-generated project context now surfaces detected run commands
  (test/build/lint/typecheck/dev) from `package.json` — the #1 non-guessable session-1 fact.
- Hardened `suggestSensorFromMemory` to reject degenerate tokens (numeric/line ranges, `file.ts:123`
  refs) so it never emits a nonsensical regex sensor (autogen stays warn-only).
- Benchmark `token_proxy` → `report_tokens_est`, relabeled "report only, NOT total agent tokens" — we
  have real runtime telemetry now; an honesty fix.

#### Fixed
- Briefing radar no longer leaks the parent repo's git history when the git toplevel is an ancestor of
  the project root.

## [0.23.0] — agent-edit coverage; guided conflict supersede

#### Added
- **`hivelore coverage` crosses the corpus with both committed git churn AND agent-edited hot files** from
  the PostToolUse observation log (`.ai/.cache/observations.jsonl`), merged and tagged per gap with its
  heat source (`git` | `agent` | `both`). New `--source git|agent|both`.
- **Conflict resolution is now a guided supersede, not just a deprecate.** `applyConflictResolution`
  promotes the winner (revision_count++, verified, linked) and has it adopt the loser's topic when it had
  none — so future `mem_save` upserts consolidate into the winner instead of spawning a third
  contradiction. `hivelore memory resolve-conflict --yes` writes both files; `mem_conflict_candidates`
  attaches a `suggested_resolution` (keep/supersede + apply command) to every pair.

## [0.22.0] — close the prevention-recording leak in the installed gate

Perfecting the existing loop (capture → brief → block → measure) before adding anything new; grounded in
a code-verified harness-engineering audit that found the headline "measure" leg leaked.

#### Fixed
- **`recordPreventionHits` is now THE single prevention recorder.** The git-hook gate, `hivelore sensors
  check`, and the anti-pattern MCP tool funnel through it (debounced), so what the installed gate
  **blocks** is finally **counted**. The regex/command-sensor path used to block without recording; only
  anti-pattern catches were recorded before.

#### Added
- `runSensorGate` records prevention for regex AND command sensors in the git-hook gate; shell/test
  command sensors run in-gate behind `enforcement.runCommandSensors`.
- `mem_tried` returns `sensor_generated` + a hint when the ratchet stays open (no paths / no distinctive
  token), so a paths-less capture isn't silently advisory-only.
- `hivelore eval` reports case provenance (synthesized vs authored) and warns when the score is purely
  self-referential.

## [0.21.0] — pre-commit gate auto-briefs; `hivelore briefing --json`

#### Added
- **Auto-brief:** the pre-commit/pre-push decision-coverage gate no longer blocks waiting for a manual
  `hivelore briefing` — it surfaces the relevant anchored decisions itself and records them in the session
  marker at commit time, then passes with `decision-coverage-autosurfaced`. New `enforcement.autoBrief`
  (default true); set false for the strict legacy gate.
- **`hivelore briefing --json`** emits the ranked memories + quality + counts (parity with the MCP
  `get_briefing` tool for scripting/CI).

#### Changed
- Stack-pack seeds get a clean "`<Stack>: <Rule>`" H1 so the corpus normalizer stops synthesizing ugly
  "Convention `<slug>`" titles.

## [0.20.1] — idempotent stack-pack re-seed, smoother decision-coverage gate

#### Fixed
- Stack-pack re-seed no longer creates duplicates across days/versions: dedup by a stable
  date-insensitive signature (`type-slug`) OR `topic` (`stack-pack:<stack>:<slug>`).
- The decision-coverage gate no longer blocks a commit over a policy memory you author in the **same**
  commit — a policy memory counts as covered when its own `.md` file is staged. Strictly loosens; never
  adds a false block.

## [0.20.0] — run regex sensors in the pre-commit gate, tighten matcher precision

#### Fixed
- **Regex sensors were orphaned from the commit gate.** The installed hook ran only `enforce check`
  (fuzzy anti-pattern matcher), while `hivelore eval` reported `catch_rate 1.0` — real commits had zero
  sensor protection. `runPrecommitPolicy` now runs `runSensorGate` (all regex sensors, any memory type)
  on the staged diff: block sensor → fails the gate, warn sensor → visible non-blocking finding.
- **Tightened fuzzy precision:** a non-anchored memory whose sensor did NOT fire → info (non-violation
  evidence); uncorroborated semantic review floor 0.6 → 0.65. Cuts the "20 mostly-irrelevant matches for
  a 3-line diff" noise that trains agents to ignore the gate.
- `memory-lint` `LOW_VALUE_GUESSABLE` now requires positive generic-advice evidence so an
  arbitrary-but-prose team policy isn't mislabeled.

## [0.19.0] — `hivelore init` generates all 12 native bridges, carrying memories + sensors

#### Changed
- A fresh `init` now produces **every** supported bridge via the shared generator, **after** seeding, so
  each carries the repo's memories + block sensors (before, init reached ~4 agents with an empty static
  template). New `--bridge-targets <all|comma-list>` (default all); `--no-bridges` still skips. The
  first-session report shows "Reach: N agent bridge(s) generated".
- The `HAIVE_PREAMBLE` shared by every bridge is upgraded to the full instructional body (repo map +
  4-step "Working through Hivelore" + Safety). Generic stack-pack memories stay **out** of bridges
  (on-thesis — bridges stay repo-specific + enforced rules).

## [0.18.0] — 12 bridge targets, +10 stack packs, eslint/npm-audit ingest

Closes the two adoption levers from the battle plan (reach + cold-start) where Hivelore was "good, not
ahead" vs memories.sh — while keeping the enforcement edge (bridges carry block sensors, not just memory
injection).

#### Added
- **Reach: 7 → 12 bridge targets.** Added `claude` (CLAUDE.md, now unified into the bridges pipeline),
  `cursor` (`.cursor/rules/haive-memories.mdc`), `roo` (`.roo/rules/haive.md`), `gemini` (GEMINI.md),
  `aider` (CONVENTIONS.md), joining cline/windsurf/continue/cody/zed/agents/copilot. Anchor paths render
  inline ("applies to: …") on every target.
- **Cold-start: +10 stack packs** — tailwind, vite, sveltekit, astro, typescript, monorepo, laravel,
  rails, dotnet, docker — with sensors where high-signal. Detection wired into `init` (composer.json →
  Laravel, Gemfile → Rails, .csproj → .NET, Dockerfile → docker, turbo.json/nx.json → monorepo).
- **`hivelore ingest --from eslint|npm-audit`:** ESLint JSON (cwd-relativized paths + derived sensor) and
  `npm audit` JSON (anchored to package.json).
- **seed-git:** new `workaround` signal (workaround/hack/band-aid/FIXME/stop-gap).

## [0.17.1] — cold-start metric integrity + proof-line wiring

Integration pass after merging Lot A (cold-start), Lot B (visible value), and Lot C (reach).

#### Fixed
- **No more fabricated "prevented mistake" events on the first post-init commit.** The anti-pattern
  gate's self-match guard only excluded `.ai/`; the same commit also stages every file
  `hivelore init` / `hivelore bridges` generate (AGENTS.md, CLAUDE.md, `.cursorrules`, `.clinerules`,
  `.windsurfrules`, …, `copilot-instructions.md`, the haive workflows, `.gitignore`, MCP configs).
  Those mirror the seeded corpus, so a single distinctive word self-matched the seeded gotchas and
  recorded false catches (inflating the dashboard prevention trend and gate-precision). Generalised
  to `isHaiveOwnedPath` and applied to the literal/semantic **and** sensor paths (the sensor path
  previously scanned the raw, unstripped diff). Real anti-patterns in real code are still caught.
- Removed dead no-op code in `core/bridges.ts` (`renderMemoriesBlock`).

#### Added
- **Briefing proof line**: `get_briefing` now appends `briefingProofLine()` to its hints, surfacing
  the measured outcome ("this harness prevented N repeated mistakes") in-context. Returns nothing on
  a cold corpus, so a fresh repo never makes a hollow claim. (Wires the Lot B × Lot C coordination
  point that shipped as a TODO.)

### Lot C: Reach & feedforward

#### Added
- **`core/bridges.ts`** — pure bridge generator (`generateBridges`, `prepareBridgeData`,
  `bridgeMemorySummary`). Formats native config files for 7 harnesses: Cline (`.clinerules`),
  Windsurf (`.windsurfrules`), Continue (`.continuerules`), Cody (`.sourcegraph/cody-rules.md`),
  Zed (`.rules`), Codex/AGENTS.md, GitHub Copilot. Each bridge includes validated memories AND
  block sensors — the enforcement differentiator vs memories.sh.
- **`cli/commands/bridges.ts`** — `hivelore bridges sync` command. Idempotent (marker-based),
  supports `--all`, `--only <targets>`, `--max-memories`, `--dry-run`.
  Also exposes `hivelore bridges list` to show target status.
- **`BRIDGE_TARGETS`, `BRIDGE_TARGET_PATH`, `BRIDGE_MARKERS`** exported from `@hivelore/core`
  for use by Lot A (`init.ts` can call `generateBridges()` at init time — C6 interface).
- **C5 hook point**: `get-briefing.ts` now has a documented insertion comment for
  `briefingProofLine()` from Lot B (when that function is ready, import and wire it there).
- Tests: `packages/core/test/bridges.test.ts` — unit + per-target snapshot tests.

## [0.17.0] — one shared briefing-priority classifier (kill the CLI/MCP drift)

The must_read / useful / background tier was implemented **twice** — in the MCP `get_briefing` tool and
in the `hivelore briefing` CLI command — each on its own data shape. They drifted: the stack-pack
down-rank and then the env-workaround down-rank each had to be added in two places, and one was missed.
This extracts the single source of truth.

### Changed
- **New `@hivelore/core` `priority` module** owns `classifyMemoryPriority(signals)` + `priorityRank`.
  Both call sites now map their evidence (MCP: semantic scores; CLI: lexical scores) into a normalized
  `PrioritySignals` and call the same classifier, so the CLI and MCP can never disagree again.
- **MCP behavior is byte-for-byte preserved** (the `get_briefing` priority tests pass unchanged). The
  CLI gains the consistency wins it was missing: `requires_human_approval`, direct **symbol** matches,
  and exact **skill** hits now rank `must_read` in `hivelore briefing` too, matching the MCP path.
- Unit-tested in `packages/core/test/priority.test.ts`; the down-rank still only applies to *soft*
  (semantic/tag) matches — an exact hit or a direct anchor on a stack-pack/env-workaround memory still
  ranks normally.

## [0.16.2] — release hygiene

- Version bump consolidating the 0.16.1 dogfooding fixes (env-workaround corpus re-tag, CLI/MCP
  ranking drift, and the anti-pattern self-match fix) into a single publishable lockstep version. No
  code change beyond the bump — the 0.16.1 work landed across two commits, so the protocol requires a
  fresh version for the second shippable commit.

## [0.16.1] — apply the env-workaround down-rank to the existing corpus

- **Re-tagged the existing dev-environment workaround memories** (`crosspackage-deps-with-xyz-ranges`,
  `installing-hiveaicore-via-npm-install`, `npm-install-g-...`) with `tooling-debt`/`dev-workflow` so
  the 0.16.0 background down-rank actually applies to them — they were high-read-count notes crowding
  the briefing.
- **Fixed a CLI/MCP ranking drift:** `hivelore briefing`'s own priority classifier mirrored the stack-pack
  down-rank but missed the new env-workaround one, so the two façades disagreed. The CLI now also caps
  env-workaround memories at `background` (verified live: the install/hot-swap notes now render
  `[background]`). Same dual-renderer drift class as the recap fix — a shared classifier is overdue.
- **Fixed an anti-pattern self-match false positive:** editing a memory's own backing file (e.g.
  re-tagging an `attempt` whose body documents `npm install -g`) re-emitted the bad pattern into the
  diff, and the gate matched the memory against *its own file* and hard-blocked. `anti-patterns-check`
  now strips `.ai/` hunks before literal/semantic matching — knowledge-base edits can't corroborate
  "you reintroduced a bad pattern in code". Surfaced by dogfooding this very release.

## [0.16.0] — friction polish from real usage (dogfooding feedback)

After driving Hivelore end-to-end to ship 0.15.0, six concrete friction/noise points surfaced from
*actual use*. This release fixes the things that wasted time or trained the user to ignore the
harness — finishing the existing, not adding scope.

### Changed
- **Decision-coverage now accumulates across briefings.** `writeBriefingMarker` unions `memory_ids`
  and `files` with the session's existing fresh marker instead of overwriting. Every `get_briefing`,
  every pre-edit injection, and every `hivelore briefing` now ADDS to the consulted set — so a broad
  commit no longer demands one giant briefing covering every relevant decision at once. This was the
  #1 friction (a documented recurring gotcha). Pass `accumulate: false` to reset for a new session.
- **Failure detection no longer cries wolf.** `hivelore observe` no longer flags a bare non-zero exit
  from commands that routinely exit non-zero without failing — `grep`/`rg` (no match), pipelines
  (the last stage / SIGPIPE sets the code), `find`, `test`, `diff`. Real build/test/runtime errors
  are still caught by reliable text signatures (`error TSxxxx`, `ENOENT`, …). Stops the
  "N failures detected" nudge from being noise an agent learns to ignore.
- **Dev-environment workarounds no longer crowd the briefing.** Memories tagged as local tooling
  debt (`dev-workflow`, `hotswap`, `dev-env`, `local-setup`, `tooling-debt`) are capped at
  `background` priority unless they directly anchor a file being edited — so repo-specific team
  policy keeps the top slots instead of being displaced by high-read-count tooling notes.
- **Auto-generated session recaps are compacted at the top of the briefing.** A recap that is just a
  tool-call/file dump ("Auto-captured session…", "Edited N files across M tool calls") is reduced to
  its Goal line + Discoveries; human/`post_task` recaps pass through in full. Applied in both
  `get_briefing` (MCP) and `hivelore briefing` (CLI).
- **Correct git-tag push advice.** `CLAUDE.md` and the release findings now recommend
  `git push origin vX.Y.Z` instead of `git push --tags` (which fails on pre-existing divergent tags).

### Notes
- New pure core helpers with unit tests: `recap` (`isAutoRecap`/`compactAutoRecapBody`),
  `isEnvWorkaroundMemory`, and `writeBriefingMarker` accumulation. CLI `detectFailure`/
  `isExpectedNonzeroExit` are now exported and tested.

## [0.15.0] — perfect the existing harness (harness-engineering gap closure P0–P3)

A grounded analysis of Hivelore against the harness-engineering literature (Fowler/Böckeler, LangChain,
Addy Osmani, awesome-harness-engineering) surfaced eight *real* gaps — verified in code, not on the
surface. This release closes all eight, finishing features the schema/UX already promised rather than
adding new scope.

### Added
- **P0-1 — executable shell/test sensors.** The schema reserved `kind: "shell" | "test"` but never ran
  them. `hivelore sensors check --commands` (or `enforcement.runCommandSensors: true`) now executes a
  memory's sensor command and treats a non-zero exit as a hit — turning lessons a regex can't express
  into real deterministic guardrails. Off by default (runs repo-authored commands).
- **P0-2 — failure-capture gate.** `hivelore enforce finish` now reads the session's `failure_hint`
  observations and flags hard failures that were never written down as a lesson. Advisory by default
  (`enforcement.failureCaptureGate: off | warn | block`) — the ratchet that stops silent re-introductions.
- **P1-3 — `hivelore coverage`.** Crosses the repo's hottest files (git churn) with the memory corpus to
  surface frequently-edited files with no covering memory — the harness blind spots. The inverse of
  `hivelore eval` (which checks the memories that exist surface correctly).
- **P1-4 — eval score trend + CI record.** `hivelore eval --record` appends each run's score to a history
  log; `hivelore eval --trend` renders a sparkline (latest/best/Δ). The generated CI gate now records and
  trends the score, so a harness-quality regression is a number, not a vibe.
- **P2-5 — `hivelore memory resolve-conflict`.** Turns a detected contradiction into a resolution:
  deterministically keeps the stronger memory (status → revision_count → recency) and deprecates the
  other. Detection existed; this applies the fix.
- **P2-6 — gate precision in the dashboard.** A new rollup shows whether the inferential anti-pattern
  gate's catches are real (useful) or noise (rejected), and suggests tightening/loosening
  `enforcement.antiPatternGate` accordingly.
- **P3-7 — `hivelore memory seed-git`.** Cold-starts the corpus by proposing draft `attempt` seeds from
  revert/hotfix commits in git history — zero manual authoring on a fresh/legacy repo.
- **P3-8 — `haive merge-driver`.** A deterministic git merge driver for memory files: collisions under
  `.ai/memories/` resolve by `revision_count → created_at` instead of leaving `<<<<<<<` markers.
  `haive merge-driver install` wires git config + `.gitattributes`.

### Notes
- All new computational layers are pure functions in `@hivelore/core` (`coverage`, `failure-coverage`,
  `eval-history`, `conflict-resolve`, `gate-precision`, `seed-git`, `merge-memory`) with unit tests;
  the CLI orchestrates I/O around them. Out of scope (deliberately): the behaviour harness (test
  generation/verification) — Hivelore complements tests, it does not replace them.

## [0.14.0] — make the harness helpful, not a burden (friction P0–P3)

The exit machinery and outcome metrics are solid; the *entry* friction was the thing that would make
an agent (or human) stop using Hivelore. This release attacks that directly — surface context, don't
block; and trim what wastes time.

### Changed
- **P0 — the pre-edit gate now ADVISES by default instead of blocking.** When you edit a file whose
  anchored team policy wasn't surfaced yet, the PreToolUse hook now *injects that memory's content
  into the agent's context* (via `additionalContext`) and **allows the edit** — no round-trip, no
  separate `hivelore briefing` command. It also records the policy into the briefing marker, so the
  commit-time decision-coverage gate accumulates coverage as you edit. Set
  `{ "enforcement": { "preEditGate": "block" } }` to keep the strict behaviour (which now also
  records context, so a simple re-issue of the edit passes — still no briefing command).
  The commit gate and CI enforcement remain the hard backstops.
- **P0 — decision-coverage ignores Hivelore-generated artifacts** (`.ai/project-context.md`,
  `.ai/code-map.json`, `.ai/.cache|.runtime|.usage/`). They are tool-generated, not human decisions,
  and were the cause of release commits being blocked over a repair-touched file.
- **P2 — `get_briefing` no longer re-emits an unchanged project context** within a short window
  (8 min). The first call sends it and records a content-hash marker; repeats omit it with a short
  notice (the agent already has it). Pass `dedupe_project_context: false` to force a full copy. Saves
  ~1.5k tokens per repeat briefing in a long session.

### Added
- **P3 — `hivelore dev link`** codifies the dist→global hot-swap (including the nested `@hivelore/core`
  copies pnpm requires), so working on Hivelore itself no longer needs a copy-paste shell snippet or an
  npm publish to test enforcement/MCP/hook changes against the real `haive` binary.
- New `enforcement.preEditGate: "advise" | "block"` config (default `advise`).

### Notes
- **P1 — diff-scan layers are now documented in-place.** `sensors check` (regex) and
  `anti_patterns_check` (memory match) are components; `pre_commit_check` combines them; `hivelore
  enforce check` is the gate. The overlapping commands now say so in their descriptions.

## [0.13.9] — prevention from the anti-pattern path + trend + recurrence

Completes the outcome-measurement story started in 0.13.8.

### Added
- **Anti-pattern catches now count as prevention events.** `anti_patterns_check` (and therefore the
  pre-commit gate) records a prevention event for its **strong, diff-corroborated** matches (a fired
  sensor, a distinctive literal overlap, or anchor+literal) — weak semantic-only matches stay
  advisory and are NOT counted. So the semantic feedback path contributes to the outcome metric, not
  just regex sensors.
- **Prevention event log + trend.** Each catch is appended to `.ai/.cache/prevention-log.jsonl`
  (gitignored telemetry, never committed). `hivelore dashboard` now shows a **trend** (catches in the
  last 7d / 30d and a weekly sparkline) computed from the log — so you can see whether the harness is
  catching more or fewer mistakes over time.
- **Recurrence metric.** The dashboard surfaces **lessons re-introduced after capture** — memories
  whose guardrail fired on **≥ 2 distinct days** (a genuinely recurring mistake, not a re-scan of the
  same diff). A high recurrence count flags a problem the team keeps reintroducing, where the root
  cause may need a stronger fix than a memory.

### Notes
- New pure `core/prevention.ts` (`appendPreventionEvent` / `loadPreventionEvents` /
  `computePreventionTrend` / `computeRecurrence`) — unit-tested; `buildDashboard` takes the events
  via options and stays pure.

## [0.13.8] — skip-ci prevention hook + outcome measurement

### Added
- **`commit-msg` hook that PREVENTS the skip-ci footgun.** `hivelore enforce install` now installs a
  `commit-msg` hook (and a `hivelore enforce commit-msg <file>` command) that blocks a commit whose
  message contains a CI-skip directive ([skip ci] / [ci skip] / [no ci]) **when the commit also
  changes shippable code** — GitHub scans the whole message and would skip CI for the entire push.
  `.ai/`-only sync commits (which legitimately use [skip ci]) are allowed, and `#` comment lines are
  ignored. This is the preventive counterpart to 0.13.7's post-hoc detection.
- **Outcome measurement — prevention events.** A new `prevented_count` / `last_prevented_at` usage
  signal records when a memory's sensor actually fires on a scanned diff (`hivelore sensors check`),
  i.e. the encoded lesson intercepted a known mistake before it landed. This is Hivelore's first true
  OUTCOME metric (defect prevented), distinct from retrieval (reads) and self-reported usefulness
  (applied). Recording is debounced (5 min) so re-scanning the same diff doesn't inflate counts.
- **`hivelore dashboard` now shows a Prevention section** (total catch events, memories with catches,
  top memories by catches), and `computeImpact` folds `prevented_count` in as a top-tier
  demonstrated-value signal (3 catches can reach "high" on their own, like applied outcomes).

## [0.13.7] — release/enforcement reliability hardening

Five fixes to the exit machinery — the brittle, footgun-prone part that lands every change.
Driven by friction hit firsthand while shipping 0.13.2–0.13.5.

### Fixed
- **A — `hivelore briefing` now records the anchored-policy memory ids in the briefing marker.**
  The decision-coverage gate suggests "Run `hivelore briefing --files …`" as its fix, but the CLI
  briefing wrote a marker with no `memory_ids`, so the suggested command never unblocked the gate
  (only the MCP `get_briefing` did). The CLI briefing now writes exactly the validated policy
  memories anchored to the requested files, using the same match function the gate uses — so the
  fix the tool proposes is the fix that unblocks. CLI/MCP briefing are now at parity here.
- **B — the atomic pre-commit staging is generalized** beyond `project-context.md` to every tracked
  `.ai/` file the lightweight repair re-synced (auto-promoted/re-validated memories, code-map),
  excluding machine-local telemetry (`.usage`/`.runtime`/`.cache`). Closes the general case of a
  later `chore: hivelore sync` tip skipping CI, not just the version-header case.
- **D — external CI integrations (SonarQube/CodeQL/Snyk/Codecov) are treated as advisory** in
  `enforce finish`: a transient failure (network/timeout) is surfaced as a non-blocking `info`
  instead of a blocking error, so an external service can't masquerade as a product regression
  (aligns with the "zero hard dependency on the user's environment" principle). Core workflow
  failures still block.
- **E — when no Actions runs exist for HEAD, the gate detects a skip-ci directive in the commit
  message** and says so explicitly (GitHub scans the whole message, subject and body), with a fix
  that points to rewording or `gh workflow run`. Turns a confusing "no runs" into an actionable cause.

### Changed
- **C — `enforce finish` now prints a single "NEXT REQUIRED ACTION"** when it blocks: the first
  blocking finding (in protocol order) with its fix, so the exit path is a guided next step instead
  of a checklist the agent must reassemble.

## [0.13.6] — strategic VS Code cockpit and English tool surface

### Added
- **VS Code Strategic Cockpit and Discipline Inbox** for observability, eval status, sensor hygiene,
  memory impact, and suggested context-discipline actions.

### Changed
- **Tool-authored copy is now consistently English** across CLI/MCP generated action-required memories,
  GitHub Action examples, VS Code docs/media, benchmark fixtures, Sonar examples, and project docs.
- **Team memory records were translated to English** while keeping IDs and anchors stable, so future
  briefings stay coherent without breaking references.

### Fixed
- GitHub Action action-required body stripping now recognizes both the new English heading and the
  legacy French heading for older auto-generated memories.

## [0.13.5] — surface coherence Phases C/D/E (disambiguation + grouping)

### Changed
- **Phase C — `bench` renamed to `selftest`** (with `bench` kept as an alias). The two near-identical
  names no longer collide: `selftest` checks the local install's latency; `benchmark` measures
  Hivelore-vs-plain agent value. Both descriptions now state the distinction explicitly.
- **Phase D — `install-hooks` and `precommit` are labelled as `enforce` equivalents** in their help
  (`install-hooks` = `enforce install`, `precommit` = `enforce check --stage pre-commit`), so the
  overlap is discoverable instead of confusing. Kept as-is (non-breaking); `enforce` remains canonical.
- **Phase E — the advanced surface is now grouped by family in `hivelore --advanced --help`**
  (reports / eval / index / runtime / ops). Shown only in advanced help so the default golden-path
  help stays focused.

### Notes
- Deeper command-tree regrouping (moving `dashboard`/`stats` under a `report` parent, or `code-search`/
  `embeddings` under `index`) is **intentionally deferred**: `report` is already a subcommand of
  `benchmark` and `index` is a leaf command, so those moves would require renaming existing commands —
  i.e. they'd be breaking, which violates the non-breaking rule of the coherence map. Documented in
  `docs/HARNESS-COHERENCE-MAP-2026-06.md`.

## [0.13.4] — atomic release commits (no more `[skip ci]` tips)

### Fixed
- **The pre-commit gate (`enforce check --stage pre-commit`) now stages the project-context version
  header it re-syncs.** Previously a version bump left `.ai/project-context.md` drifting (the repair
  ran *after* staging), so the `haive-sync` workflow committed a `chore: hivelore sync [skip ci]` tip on
  top of the release — which skips CI for the whole push. Now the re-synced header lands in the release
  commit itself, keeping the release commit the push tip (decision
  `2026-06-02-decision-atomic-release-commit-and-skip-ci-tip`). Best-effort and scoped to the
  project-context file, so telemetry churn (the tool-usage log) still flows through a later sync.

## [0.13.3] — golden path made visible (harness coherence, Phase B)

### Changed
- **`hivelore --help` now documents the golden path** — the day-to-day workflow
  (`init → doctor → agent setup → briefing → memory save/tried → sensors check → enforce finish → sync → session end`)
  and the CLI↔MCP verb parity (`memory save/search/get/delete ↔ mem_save/mem_search/mem_get/mem_delete`,
  old verbs still aliased). Makes the already-existing focused surface (core commands visible by default,
  the rest one `--advanced` away) explicit instead of implicit.
- **README**: new "CLI at a glance — the golden path" section with the ~11 core commands grouped by
  lifecycle stage and the verb-parity note. Phase B of `docs/HARNESS-COHERENCE-MAP-2026-06.md`.

## [0.13.2] — CLI verbs aligned with MCP tool names (harness coherence, Phase A)

### Changed
- **`hivelore memory` verbs now mirror the MCP tool names** so an agent learns one vocabulary across
  both façades: `add → save`, `query → search`, `show → get`, `rm → delete`. The old verbs remain
  as **aliases** (`save|add`, `search|query`, `get|show`, `delete|rm`) — no existing script or hook
  breaks. The core memory surface and user-facing hints (`doctor`, `welcome`, `sync`, `stats`,
  `memory pending`) now use the canonical verbs.
- Background: a CLI/MCP surface coherence audit found the real cohesion gap was **vocabulary drift
  between the two façades** (not duplicate commands, and not a flat surface — the golden path and
  MCP tool profiles already existed). See `docs/HARNESS-COHERENCE-MAP-2026-06.md`.

### Notes
- `memory digest` (a Markdown review report) is intentionally **not** aliased to MCP `mem_distill`
  (observation clustering) — they are different operations. That parity gap is tracked, not papered over.

## [0.13.1] — regression gate wired into generated CI

### Added
- **`hivelore init` now wires `hivelore eval --regression-gate` into the generated CI** (a `pr-eval-gate`
  job in `haive-sync.yml`, runs on pull requests). It fails a PR only when the harness quality score
  drops vs the committed `.ai/eval/baseline.json`, and is a **no-op when no baseline exists** — so it
  is safe to ship enabled by default and needs nothing external (no secrets, no services). Create a
  baseline with `hivelore eval --baseline` to turn the gate on.

## [0.13.0] — portable extensions (Sonar live-fetch, regression gate, more packs)

> Design principle reinforced this release: **every Hivelore tool works standalone**. No command
> requires an external service or a specific local setup; optional integrations degrade gracefully
> with one clear message and never crash. See decision
> `2026-06-02-decision-tools-must-be-environment-independent`.

### Added
- **`hivelore ingest --from sonar-api`** — fetch open issues live from any SonarQube/SonarCloud
  instance over plain HTTPS (Node built-in `fetch`), with `--sonar-url` / `--sonar-token` /
  `--sonar-component` (or `SONAR_HOST_URL` / `SONAR_TOKEN`). **No MCP or special setup required** —
  if creds are absent it prints one actionable message and exits; file-based `--from sonar|sarif`
  always works regardless.
- **`hivelore eval --regression-gate`** — CI-safe quality gate: compares against the baseline IF one
  exists (failing on a score regression) and otherwise no-ops (exit 0), so it can be dropped into any
  pipeline unconditionally.
- **Three new stack packs** — `flask`, `vue`, `spring` — with curated sensors (flask
  `app.run(debug=True)`, vue `v-html` XSS, spring wildcard `@CrossOrigin`).

## [0.12.9] — eval baseline & delta reporting

### Added
- **`hivelore eval --baseline`** snapshots the current report to `.ai/eval/baseline.json`, and
  **`hivelore eval --compare`** re-runs and prints the per-metric delta (overall score, mean recall,
  MRR, sensor catch-rate) with an IMPROVED / REGRESSED / UNCHANGED verdict — making the "Hivelore
  improves agent retrieval by N%" claim reproducible.
- **`--fail-on-regression`** turns a score drop vs the baseline into a non-zero exit for CI gates;
  **`--baseline-file <path>`** overrides the default location.
- New pure `compareEvalReports` / `EvalDelta` in `core/eval.ts` (CLI does the I/O).

## [0.12.8] — AGENTS.md portable bridge

### Added
- **`hivelore init` now emits `AGENTS.md`** (the emerging cross-harness convention used by Codex and
  others) alongside CLAUDE.md / .cursorrules / copilot-instructions.md, so the `.ai/` corpus is
  consumable by any AGENTS.md-aware agent — not just Claude.
- **`hivelore sync --inject-bridge` injects the memory breadcrumbs into both CLAUDE.md and AGENTS.md**
  by default (when present). An explicit `--bridge-file` still targets a single file.

## [0.12.7] — stack packs with executable sensors + backend packs

### Added
- **Stack-pack memories can now carry a curated regex `sensor`** — seeded templates become
  feedforward+feedback guardrails (the lesson fires deterministically on the user's own diff, not
  just when the briefing surfaces it). Seed sensors are `warn` + `autogen:false` (vetted; never
  auto-block).
- Crisp sensors added to high-signal existing packs: Next.js `NEXT_PUBLIC_*` secret leak, React
  `key={index}`.
- **Three new backend stack packs**: `fastapi`, `django`, `go` (seed via `hivelore init --stack
  fastapi,django,go`). Carry sensors where a precise pattern exists — django `DEBUG = True` and
  hardcoded `SECRET_KEY`, fastapi `uvicorn reload=True` and bare `except:`.

## [0.12.6] — observability dashboard

### Added
- **`hivelore dashboard` (+ `--json`)** — a non-interactive, scriptable observability snapshot of the
  memory corpus that an agent or CI job can read in one shot (unlike `hivelore tui`, which needs a TTY).
  Surfaces: inventory (by scope/type/status, active vs retired), impact tiers + the top memories by
  demonstrated utility, sensors (totals by severity + which ones actually fired), health (stale /
  anchorless / pending / prune candidates), decay (>90d), and corpus token weight.
- New pure core module `dashboard.ts` (`buildDashboard`) aggregating the existing impact, usage,
  sensor, retirement and decay primitives. No I/O — unit-tested in `core/test/dashboard.test.ts`.

## [0.12.5] — findings ingestion (self-feeding sensors)

### Added
- **`hivelore ingest` + `ingest_findings` MCP tool** — turn scanner findings (SonarQube issues JSON
  or any SARIF report from ESLint/Semgrep/CodeQL) into proposed, anchored `gotcha`/`convention`
  memories, pre-filled with a conservative `warn` sensor. This closes the review↔memory loop and
  kills the cold-start problem: a real defect a scanner found becomes a permanent guardrail that
  steers the next agent away from it.
- New pure core module `findings.ts`: `parseSarif`, `parseSonar`, `parseFindings`,
  `normalizeFindingSeverity`, `findingToDraft`, `draftsFromFindings`, `filterNewDrafts`. No I/O.
- Cross-run dedup via a stable `topic: ingest:<tool>:<rule>:<path>`, so re-running a scan upserts
  instead of duplicating. `--dry-run`, `--min-severity`, `--limit`, `--scope`, `--type` supported.

### Safety
- Ingested drafts are `status: proposed` and their sensors are `severity: warn` + `autogen: true`.
  Ingestion never auto-validates and never auto-blocks — a human reviews (`hivelore memory pending`)
  and promotes (`hivelore sensors promote <id> --yes`).

### Docs
- `docs/HARNESS-ROADMAP-2026-06.md` — reconciles a harness-engineering research wishlist against the
  actual codebase (most points already shipped) and sets the execution order; findings ingestion (B)
  was the one genuine gap and is delivered here.

## [0.12.4] — pipeline-aware finish gate

### Added
- **`hivelore enforce finish` now verifies GitHub Actions before agents close a task.** When the
  pushed HEAD has a GitHub remote, the finish gate checks `gh run list --commit <sha>` and blocks
  on missing, pending, failed, cancelled, or otherwise non-successful workflow runs.
- Added agent-facing closeout guidance in the post-task prompt, generated Hivelore bridge rules, and
  the team close-session skill so future agents know that remote pipeline success is part of the
  exit protocol.

## [0.12.3] — CI decision coverage runner fix

### Fixed
- **`hivelore enforce ci` no longer fails on local-only briefing markers.** GitHub Actions does not
  have the agent's `.ai/.runtime/enforcement/briefings` marker after push, so CI now reconstructs
  decision coverage from the committed diff and reports `decision-coverage-ci-pass` instead of
  blocking with `decision-coverage-missing`. Local/pre-commit/pre-push gates still require the
  real briefing marker.

## [0.12.2] — quality gate and doctor excellence pass

### Added
- **Repo-native eval specs** — `hivelore eval` now auto-loads `.ai/eval/spec.json` when present and
  merges those labeled cases with synthesized anchored-memory retrieval cases. Hivelore's own CI now
  exercises eight executable sensor cases, so the 0–100 score covers retrieval and guardrail catch-rate.
- **Sharper setup diagnostics** — `hivelore doctor` now reports missing local `pnpm`, stale or missing
  workspace `dist` artifacts, and dist/source version mismatch as explicit actionable findings.
- **Architecture coverage memories** — core, CLI, and MCP package boundaries are documented as anchored
  team memories so harness coverage reflects real module policy instead of generic advice.

### Improved
- Low-value generic workflow memories were rewritten as concrete Hivelore release/toolchain policies,
  including the exact CI-equivalent command chain and the `npx pnpm@9.14.2` fallback.
- CLI docs, README, and PLAN now describe eval specs, doctor setup drift checks, and the current
  harness-engineering positioning.

## [0.12.1] — hybrid lexical rerank (much better semantic retrieval)

### Improved
- **`get_briefing` / `mem_relevant_to` ranking** now blends a BM25 lexical-relevance score
  (over the candidate set) into the sort. Previously a handful of popular high-read `attempt`
  memories dominated *every* task because their type+confidence bonuses dwarfed the semantic
  cosine (0–1); the actually on-topic memory got buried. The lexical term (weight ≤12, well
  below the priority tier) lifts the memory that shares the query's distinctive terms.
  Measured with `hivelore eval`: semantic-only retrieval **19 → 98**, anchored **95 → 100**
  (no regression — anchored/symbol matches stay must_read).

## [0.12.0] — fewer false positives, CLI parity, eval CI gate

### Fixed
- **Pre-commit false positives** — the anchored gate hard-blocked whenever a diff shared
  *any* ≥4-char token with an anchored gotcha's body, firing on ubiquitous domain words
  ("memory", "scope", "input", "version") and on version-bump diffs — making agents work for
  nothing. A `literal` overlap now only corroborates a **block** when at least one shared token
  is *distinctive* to that gotcha (rare in the corpus, TF-IDF style; `core/distinctive.ts`).
  Common-word overlaps still surface for review but never hard-block.

### Added
- **`hivelore memory feedback <id> --applied|--rejected`** — CLI mirror of the `mem_feedback`
  MCP tool, closing the impact loop from the terminal.
- **`hivelore memory add --activation-keyword/--activation-glob/--activation-always`** — author
  skill progressive-disclosure triggers from the CLI.
- **`hivelore eval --fail-under <score>`** — non-zero exit below the threshold; wired into CI
  (`ci.yml`) so a briefing-retrieval or sensor-catch-rate regression fails the build.

## [0.11.0] — impact-aware ranking, eval harness, skill activation

### Added
- **Impact-aware briefing ranking** — `get_briefing` (and `mem_relevant_to`) now factor a
  memory's demonstrated-utility score into ranking: a memory agents actually applied, or whose
  sensor caught a regression, edges out an equally-relevant one that never proved useful. The
  nudge is small by design and never overrides anchor/symbol relevance. `impact_score` /
  `impact_tier` are surfaced on each briefing memory for transparency.
- **`hivelore eval`** — a rigorous, model-free, CI-runnable quality eval. Measures briefing
  retrieval (recall + MRR) and sensor catch-rate against labeled cases (`--spec`), or
  auto-synthesizes cases from the repo's own anchored memories (zero setup). Emits a chiffré
  0–100 score so a ranking/sensor regression fails the build. `--semantic-only`, `-k`, `--json`,
  `--out`.
- **Selective skill activation (progressive disclosure)** — `skill` memories may declare an
  `activation` block (`keywords` / `globs` / `always`). A skill with activation triggers is
  surfaced only when the task or edited files match, and an activated skill earns a ranking
  boost; skills without the block keep the legacy always-eligible behavior. Authorable via
  `mem_save`.

## [0.10.10] — closed-loop memory impact

### Added
- **Memory impact scoring** — new pure `computeImpact` (in `@hivelore/core`) combines the utility
  signals Hivelore already recorded but never correlated: reads + applied outcomes + a sensor that
  actually fired (positive) versus rejections, stale status, and dormancy (negative) into a single
  0–1 score, a tier (`high|medium|low|dormant`), and a prune-candidate flag.
- **`mem_feedback` MCP tool** — agents record whether a surfaced memory was `applied` (it steered
  the work) or `rejected` (wrong/unhelpful). This closes the loop: a read only means a memory was
  shown; `applied` means it demonstrably helped. Backed by a new `applied_count` usage signal.
- **`hivelore memory impact` CLI** — ranks memories by demonstrated utility and surfaces prune
  candidates (`--prune`), with `--tier`, `--id`, and `--json` filters.

### Notes
- Surfacing impact as a ranking weight inside `get_briefing` is intentionally deferred to a later
  increment to avoid destabilizing the briefing pipeline. Legacy `usage.json` records are
  normalized for the new fields, so the change is backward compatible.

## [0.10.9] — finish gate and release discipline

### Added
- **Final agent-exit gate** — `hivelore enforce finish` verifies that completed work is committed, pushed, versioned in lockstep, tagged, and that release tags exist on the remote.
- **Release-protocol prompt wiring** — bridge templates, post-task guidance, and project docs now instruct agents to run the finish gate before final responses.

### Fixed
- CI enforcement now inspects the committed base/head diff instead of only staged files.
- Shippable package typechecks no longer depend on stale workspace `dist/` artifacts.
- Autopilot repairs, stack-pack diagnostics, and assignment-style memory sensors now handle the audited edge cases more precisely.

## [0.10.5] — sensor promotion and sharper patterns

### Added
- **Sensor promotion workflow** — `hivelore sensors promote <memory-id> --yes` flips a vetted memory
  sensor to `severity: block`; `--severity warn` can soften it again.

### Changed
- **Sharper autogenerated sensor patterns** — assignment-style gotchas such as `open-in-view=true`
  now generate regexes that include the offending value instead of matching only the broad key.

## [0.10.4] — memory sensors Phase 2

### Added
- **Memory sensors Phase 2** — sensors now parse unified diffs per file, use stricter path scoping,
  surface `severity: block` as deterministic pre-commit blockers, and can be operated with
  `hivelore sensors list/check/export`.
- **Assisted sensor generation** — anchored `gotcha`/`attempt` records saved through `mem_save`,
  `mem_tried`, `hivelore memory add`, or `hivelore memory tried` can receive conservative autogenerated
  `warn` regex sensors.

## [0.10.3] — memory sensors (feedback computational layer)

### Added
- **Executable sensors** — a memory (`gotcha`/`attempt`) can now carry an optional `sensor` block in
  its frontmatter (`packages/core/src/schema.ts` → `SensorSchema`). Phase 1 supports `kind: "regex"`:
  a deterministic check that fires on the **added** lines of a diff, turning a documented lesson into a
  permanent guardrail. This is the harness "feedback computational" layer — same result every run, no
  embedding warmup. `shell`/`test` kinds are reserved for a later phase.
- **`@hivelore/core` sensor engine** — new `packages/core/src/sensors.ts`: `runSensors`, `runRegexSensor`,
  `compileRegexSensor`, `sensorAppliesToPath`, `addedLinesFromDiff` (pure, no I/O).
- **`anti_patterns_check` sensor reason** — sensors are evaluated alongside anchor/literal/semantic
  matches and surface as a new `"sensor"` reason, carrying `sensor_message` and `sensor_severity`.
  Sensor hits rank above all other reasons (deterministic, highest signal). Retired memories
  (`isRetiredMemory`) are excluded as before.

## [0.10.2] — harness positioning

### Changed
- **Product positioning clarified** — public docs, npm metadata, and CLI help now describe Hivelore as
  "repo-native memory and context policy for coding-agent harnesses", with explicit boundaries around
  tests, linters, evals, observability, and security tooling.

## [0.10.1] — corpus lifecycle and release guardrails

### Added
- **Build artifact verification** — new `pnpm check:artifacts` guard verifies the lockstep package versions and the
  built CLI/MCP versions after `pnpm -r build`; CI now runs it before typecheck/tests so stale dist/version skew is caught
  explicitly.
- **Memory lifecycle retirement** — `expires_when`, `obsolete`/`superseded`/`archived` tags, and explicit audit/history-only
  fixed notes now remove records from active briefings and anti-pattern scans by default. `memory lint` flags active records
  whose lifecycle metadata says they should be retired.

### Changed
- **Anti-pattern semantic noise** — semantic-only anti-pattern hits now require a default score of `0.45`; anchor/literal
  matches still surface, but weak broad semantic matches no longer pollute review output.
- Removed the duplicate `code_search` registration from the maintenance MCP profile.

## [0.10.0] — positioned for the unguessable

A benchmark (10 cold agents, 5 projects, hidden-policy rubric) showed Hivelore's real value: **correctness
on arbitrary, team-specific knowledge a model cannot infer (5/5 vs 3/5)** — not speed or token savings
(on inferable tasks it was pure overhead). This release re-shapes the product around that truth.

### Added
- **Specificity ("surprise") scoring** (`specificityScore`, `isLikelyGuessable` in `@hivelore/core`) — a
  cheap heuristic estimating how *unguessable* a memory is (concrete literals/identifiers/values vs generic prose).
- **Adaptive briefing.** `get_briefing` now returns `briefing_value: "high" | "low"`. When nothing
  team-specific matches the files/task, the auto-generated/unfilled project context is trimmed to a
  one-line note so the call stays near-zero-cost (config: `adaptiveBriefing`, default on). A capable
  model needs nothing extra there. Curated context is never trimmed. The `hivelore briefing` CLI mirrors this.
- **`memory lint` LOW_VALUE_GUESSABLE** — flags memories that read like generic best practice the model
  already follows, nudging curation toward unguessable team knowledge.
- **Aggressive corpus decay**: `hivelore memory archive --unread` deprecates memories by unread-age alone
  (ignoring anchor state); window defaults to `enforcement.decayAfterDays` (180). A stale corpus is
  actively harmful — it makes agents follow outdated policy.
- **Capture filter**: `mem_observe` now SKIPS low-specificity (guessable) observations by default to keep
  the corpus high-signal; pass `force: true` to override.

### Changed
- **Diff-aware gate.** Anti-pattern literal matching now considers only ADDED diff lines, so the gate
  fires on "you introduced the bad pattern", not "you touched/removed a file that mentions it" — fewer
  false positives on refactors.
- **Tighter CLI surface.** Default `hivelore --help` shows the 10-command core harness loop; `tui`,
  `welcome`, and the manual `precommit` variant move behind `--advanced` (everything still works).
- **Repositioned.** README/tagline now lead with the proven value — *stop agents from reinventing,
  wrongly, your team's non-obvious decisions* — and the benchmark section reports the honest 5/5-vs-3/5
  results with the real per-policy-type token costs. All speed/token-savings claims removed.

## [0.9.31] — gate consistency

### Fixed
- **`hivelore precommit` now honors `enforcement.antiPatternGate`.** Previously the standalone command always used its own `--anchored-blocks` default and ignored project config, so a team that softened the gate to `review` (or `off`) in `.ai/haive.config.json` still got hard blocks when running `hivelore precommit` by hand — diverging from the installed git hook. The gate→params mapping is now centralized in `@hivelore/core` (`antiPatternGateParams`) and consumed by both `hivelore enforce check` (the hook) and `hivelore precommit`, so the two surfaces can no longer drift. Explicit flags still override: `--block-on <mode>` and `--no-anchored-blocks`.

## [0.9.30] — enforcement honesty & quality pass

### Added
- **Honest, configurable anti-pattern gate.** New `enforcement.antiPatternGate` config (`off` · `review` · `anchored` (default) · `strict`). In `anchored` mode the pre-commit gate now **hard-blocks** a high-confidence `attempt`/`gotcha` that is anchored to a file you touch and corroborated by the diff — closing the gap where the documented "known bad approaches are blocked" only surfaced as a soft review. `pre_commit_check` gained an `anchored_blocks` parameter (and `hivelore precommit` a `--no-anchored-blocks` opt-out). Config/docs-only commits are still never hard-blocked.
- **Deterministic literal matching.** `anti-patterns-check` now tokenizes diffs on non-word boundaries (code-aware, with a keyword stoplist), so identifiers glued to punctuation (`Number(BigInt(a))`) reliably produce a `literal` signal instead of leaving blocking to depend on a warmup-sensitive semantic score.
- **`hivelore index code --status [--json]`** — report code-map / code-search index freshness without rebuilding.
- **`hivelore memory verify --json`** — machine-readable anchor-freshness output for CI/agents (exit 1 on stale).
- **`--files` alias for `--paths`** on `memory add` / `memory tried` / `memory update`, matching the MCP `files` parameter.

### Changed
- **Stack detection** no longer mislabels a TypeScript project as JavaScript when there is no root `tsconfig.json` — it scans for `.ts`/`.tsx` sources.
- **CI hardening:** type-check now runs *before* tests and is **blocking** (removed `continue-on-error`), catching the source/dist desync that previously surfaced only as confusing test failures.
- **Clearer `hivelore init` messaging:** user-level MCP client configs are reported as "user-level config — left unchanged" so it no longer looks like the project setup was skipped.
- **README aligned with reality:** enforcement section describes precise anchored blocking vs. surfaced review; the benchmark section now presents the honest internal pilot (`n=3`, proxy tokens, no raw-speed claim) instead of inflated headline deltas.

## [0.9.29] — developer curation

### Added
- **`hivelore memory seed [stack]`** — seed a stack pack of starter memories on demand (after `hivelore init`). Auto-detects stacks from `package.json` when no argument is given, supports `--list` / `--list --json` for discovery, and refreshes the embeddings index in autopilot. Seeded memories carry the `stack-pack` tag and stay at background priority until anchored.
- Enforcement hooks now give file-specific must-read reminders during `pre-tool-use` when a write targets files covered by validated anchored policies that were not in the current briefing.

### Changed
- `hivelore briefing`, `hivelore enforce session-start`, and wrapped `hivelore run` sessions now attempt lightweight autopilot repairs before generating context, so stale/missing semantic indexes are fixed before agents need them.
- `hivelore session end --auto` can synthesize a useful recap from the current git diff when no hook observation log is available.
- Enforcement findings now carry clearer educational details (`why`, files, and memory IDs) for missing decision coverage.

## [vscode-0.6.1] — brand icon

### Added
- **Brand icon & glyph** — honeycomb cluster with a single glowing amber cell (the "surfaced memory" signature). `media/icon.png` (256×256) is the Marketplace icon; the activity-bar container now uses the monochrome `media/logo-mono.svg` glyph (themable via `currentColor`) instead of the `$(book)` codicon. Adds `favicon.*`, `logo.svg`, `wordmark.svg`, and a README header logo. The preview page `media/index.html` is excluded from the packaged `.vsix`.

## [vscode-0.6.0] — developer curation actions

### Added
- **Seed starter memories from the editor** — `Hivelore: Add Starter Memories (Stack Pack)…` (sidebar title + command palette) lists supported stacks (auto-detected ones first) and seeds the chosen pack via `hivelore memory seed`.
- **Anchor a memory/seed to a file** — `Hivelore: Anchor Memory to File…` (context menu on any memory; inline action on seeds) anchors the record to the active file or one you pick, turning a generic background seed into high-signal, repo-specific context.
- **Promote a memory to the team** — `Hivelore: Promote Memory to Team` runs `hivelore memory promote` from the tree.
- **"🌱 Seeds — needs curation" group** — unanchored `stack-pack` seeds are surfaced as a dedicated curation queue with a 🌱 badge and a tooltip explaining how to raise them above background priority. Seed items expose an inline anchor action.
- Mutating curation actions run via the configured `haive.cliPath`, stream output to the Hivelore channel, and auto-refresh the tree/status bar.

## [0.9.28] — signal & coordination polish

### Changed
- **Stack-pack seeds no longer crowd out repo knowledge.** Memories pre-seeded at `hivelore init` are tagged `stack-pack` and capped at `background` priority in both the MCP `get_briefing` and the CLI `hivelore briefing` rankings, so a generic framework note never outranks a repo-specific memory unless it has been anchored to a file you are actually editing. Each seed now carries an honest footer, and the init message no longer calls them "validated team memories useful from J+0".
- **Bridge files are now a table of contents, not a manual.** `CLAUDE.md` / `.cursorrules` / `copilot-instructions.md` use a shorter, less imperative template (~25 lines), and `hivelore sync --inject-bridge` injects one summary line per memory (not full bodies) and skips `stack-pack` seeds — keeping the always-loaded bridge compact.
- **`pre_commit_check` weights warnings by file type.** A package/build/tooling gotcha (by tag or anchor) is downgraded to `info` when the change touches no package/build file, mirroring the existing config/docs-only downgrade. Cuts false positives on pure source edits.

### Added
- **MCP `get_briefing` (and `mem_relevant_to`) now write the enforcement briefing marker.** An MCP-native agent that calls `get_briefing` before editing satisfies the pre-tool-use / pre-commit gate directly, without shelling out to the CLI `hivelore briefing`. The marker records the surfaced anchored policy IDs so the per-file decision-coverage check passes for the files the briefing covered.

### Fixed
- Root `package.json` and `.ai/project-context.md` version aligned with the package builds (was `0.9.26` vs `0.9.27`), clearing the `repo-root-version-mismatch` doctor finding.
- Removed the obsolete `2026-04-28-decision-v028-features-overview` draft memory (shipped long ago, fully covered by this changelog) that had been flagged as a 30+ day stale draft and was polluting briefings for core files.

## [0.9.24] — autopilot indexing polish

### Fixed
- `hivelore index code` now includes untracked source files that are not ignored by git, so fresh or in-progress repos get useful code-map and code-search indexes before the first commit.
- `hivelore precommit --json` now emits valid JSON even when no files are staged.
- `hivelore memory add` in autopilot mode now refreshes the memory embeddings index immediately after creating or updating a record.
- `hivelore doctor --fix` now forces a code-map refresh when repairing autopilot indexes, while avoiding rewrites when the indexed file set is unchanged.

## [0.9.23] — cleanup and precommit signal polish

### Fixed
- `hivelore enforce cleanup` now preserves `.ai/.cache/.gitignore` while removing cache contents, so existing repos keep generated cache files ignored after cleanup.
- `pre_commit_check` now requires a very strong semantic score before blocking anti-pattern matches, reducing false positives from generic historical test notes while keeping plausible matches in review.

## [0.9.22] — autopilot convergence polish

### Fixed
- `hivelore doctor --fix` now refreshes memory embeddings as part of corpus repair, so semantic briefing diagnostics can converge without a separate manual `hivelore embeddings index`.
- Project-context version repair now works for generic bootstrapped contexts, not only the Hivelore repo's own `# Project context — Hivelore (v...)` heading.
- `hivelore init --bootstrap` writes current project version metadata and prepares `.ai/.cache` / `.ai/.runtime` ignore files from day zero.
- `hivelore enforce cleanup` preserves briefing markers while removing disposable runtime/cache files, so cleanup no longer makes local enforcement fail immediately afterward.
- `hivelore memory add` can derive a slug automatically and wraps plain bodies in a lint-friendly heading/guidance structure.
- `hivelore memory lint` no longer flags brand-new validated memories as `NEVER_READ` before agents have had time to surface them.
- `hivelore briefing --format compact` is accepted as a compatibility alias for users coming from the MCP `get_briefing` API.
- Root/workspace version skew and stale global Hivelore packages are now visible in `hivelore doctor` for the Hivelore workspace.

### Changed
- Harness coverage wording is stricter: sub-50% coverage is now described as partial instead of "good".
- pnpm overrides moved from the deprecated root `package.json` field into `pnpm-workspace.yaml`.

## [0.9.21] — quality audit fixes

### Fixed
- `hivelore memory pending` now shows both `draft` and `proposed` memories (was silently ignoring drafts). Output is grouped and labeled: "Proposed — awaiting team validation" / "Draft — created but not yet activated".
- `hivelore memory list` now displays the memory title (first `#` heading from body) between the ID and file path lines — consistent with `hivelore welcome`.
- `hivelore memory tried` help text had a duplicate `(default: personal)` from Commander double-printing — fixed.
- VS Code Harness Health view: `DoctorScores` interface field names now match the actual `hivelore doctor --json` output (`protection_score`, `context_quality_score`, `corpus_quality_score`). Previously all scores showed as `undefined`/NaN.
- VS Code Harness Health view: `DoctorFinding.severity` now matches JSON (was incorrectly `level`), fixing finding icons.
- Root `package.json` version bumped to `0.9.20` (was stale at `0.9.19`).
- `.ai/project-context.md` version header updated to `v0.9.20`.

### Added
- `hivelore memory update` now accepts `--type <type>` to change a memory's type without losing its usage history (previously required `rm` + `add`).
- `hivelore memory update` now accepts `--body-file <path>` to load body from a Markdown file — consistent with `hivelore memory add`.
- `hivelore tui` is now visible in the default CLI help (was hidden behind `--advanced`). It is the primary interactive memory browser for humans.
- `hivelore session` command description now explains that session start is automatic (via hooks/MCP), so users are not confused by the absence of `hivelore session start`.

## [vscode-0.5.0] — harness engineering extension redesign

### Added
- **Harness Health view** — second panel in the Hivelore sidebar that runs `hivelore doctor --json` and displays protection, context quality, corpus quality, and harness coverage scores with color-coded pass/warn/error indicators. Findings grouped by section, expandable in the tree.
- **`skill` memory type** — `⚡ Skills` group appears first (after action-required alerts) in the sidebar tree, before all other types. Skill memories always expanded. CodeLens summary shows skills first with `⚡` icon.
- **Search memories command** (`Ctrl+Shift+H` / `Cmd+Shift+H`) — QuickPick fuzzy search across all memory titles, scopes, types, and tags. Opens the selected memory file beside the current editor.
- **Briefing command** (`Ctrl+Shift+B` / `Cmd+Shift+B`) — runs `hivelore briefing` for the active file and displays results in an "Hivelore Briefing" Output Channel with Markdown syntax highlighting.
- **`haive.runDoctor` command** — runs a full health check from VS Code, populates the Harness Health view, and reveals it.
- **`haive.syncMemories` command** — runs `hivelore sync`, reloads the tree, shows progress in status bar.
- **`haive.memTried` command** — two-step input (what + why) that runs `hivelore memory tried` in a terminal. Available in the editor right-click menu.
- **Approve / Reject memory commands** — context menu on tree memory items; also accessible by ID.
- **Show All Memories command** — clears the file filter and shows the full tree.
- **Pending Review group** — draft and proposed memories grouped under "🕐 Pending Review" (collapsed by default) so nothing gets lost in the queue.
- **Briefing panel** available from editor title bar and editor right-click menu (`haive.runBriefing`).
- **`haive.cliPath` setting** — absolute path to the haive binary for environments where haive is not on PATH.
- **`haive.briefingBudget` setting** — `default | deep | minimal` controls the token budget passed to `hivelore briefing`.

### Changed
- Status bar now shows pending count alongside action-required count.
- Memory tooltips now include read count, module, and domain fields.
- CodeLens per-memory list sorted by type priority (skills first, gotchas second).
- Stale memories shown with a dimmed icon in the tree.
- Unknown memory types no longer pollute the main list — collected into an "Other" group.

## [0.9.20] — harness engineering positioning + skill type + harness coverage

### Added
- New memory type `skill` — reusable procedure/playbook for recurring tasks (e.g. deploy checklist, code-review protocol). Equivalent to OpenAI's SKILL.md pattern. Skills are always surfaced as at least `useful` in briefings, `must_read` when they match semantically. No anchor required.
- `hivelore doctor` now reports a `harness_coverage_score` — the percentage of code-map files that have at least one validated memory anchor. Visible in both `--json` output and the human-readable "Harness coverage" section.
- `hivelore welcome` now lists `skill` memories first (before decisions, architecture, conventions) as they are the primary feedforward guides for new team members.

### Changed
- CLI description updated to "the memory and enforcement layer of your agent harness" to align with the harness engineering vocabulary (see [OpenAI harness engineering](https://openai.com/index/harness-engineering/)).
- All package descriptions and keywords updated with "harness-engineering".
- `skill`, `glossary`, and `session_recap` types are now excluded from the anchorless-majority warning in `hivelore doctor` and the per-memory anchor warning in `hivelore memory add` — these types are procedural/reference records that don't track code drift.

## [0.9.19] — bundled semantic autopilot

### Added
- `@hivelore/cli` and `@hivelore/mcp` now install `@hivelore/embeddings` as a real dependency, so a normal global Hivelore install includes semantic memory ranking and code-search support.
- `hivelore doctor` now checks embeddings availability, memory semantic index health, and code-search index health instead of reporting a healthy context score while semantic features are unavailable.
- The default MCP enforcement profile now exposes `code_search`, matching the code-search index that autopilot maintains.

### Changed
- `hivelore memory suggest --auto-save` now follows project defaults: autopilot projects save validated team records, while manual projects keep draft review flow.
- Generated memory-suggest templates now reference the real memory id in follow-up commands instead of a truncated query string.

## [0.9.18] — self-maintaining autopilot

### Added
- Added `autoRepair` config so autopilot can safely maintain project context metadata, corpus lint fixes, code-map refreshes, and code-search indexes without manual intervention.
- Added shared autopilot repair utilities used by `hivelore doctor --fix` and `hivelore sync`.
- `hivelore init` now writes autopilot projects with validated team memories, self-repair enabled, code-map creation, MCP setup, hooks, and CI from day zero.

### Changed
- `hivelore memory add` now follows project config defaults: autopilot projects create validated team records unless a scope is explicitly provided.
- `hivelore sync` now applies safe corpus/context repairs in autopilot mode and rebuilds both memory and code embedding indexes when code-search auto-repair is enabled.
- `hivelore doctor` reports project-context version drift without mutating files unless `--fix` is used.

### Fixed
- Autopilot init no longer suggests bootstrapping project context when the default autopilot bootstrap already ran.
- Memory lint anchor suggestions now ignore generated, ignored, and untracked paths to avoid polluting context records with noisy anchors.

## [0.9.17] — core signal quality and surgical enforcement

### Added
- `get_briefing` and `mem_relevant_to` now classify returned memories as `must_read`, `useful`, or `background`, and include a `briefing_quality` summary (`strong`, `thin`, or `noisy`).
- `hivelore memory lint --fix --dry-run|--apply` now reports simple corpus repairs and can add missing headings plus `needs_anchor` tags for validated anchorless policy records.
- `hivelore enforce check/status/ci --explain` now groups findings into blocking, review, and info sections.
- `hivelore doctor --json` now exposes protection, context quality, and corpus quality scores with sectioned findings and next actions.

### Changed
- Briefing ranking now prioritizes direct path/symbol anchors and directly relevant failed attempts ahead of popular but less relevant memories.
- `hivelore briefing` defaults to a tighter memory cap and prints memory priorities plus a briefing quality line.
- Precommit enforcement downgrades weak docs/changelog, config-only, and `.ai/.usage` telemetry matches to reduce false positives.

### Fixed
- `mem_save` topic upsert no longer writes `body` into frontmatter.
- `mem_save` now emits a strong warning when validated `decision`, `gotcha`, or `architecture` memories are saved without anchors.

## [0.9.16] — focused core surface and MCP profiles

### Added
- Added explicit MCP tool profiles: `enforcement` for the compact agent harness, `maintenance` for corpus/team stewardship, and `experimental` for broad research diagnostics; `full` remains a legacy alias for `experimental`.
- Added exported MCP profile constants and `getAllowedToolsForProfile()` so tests and integrators share the same source of truth.

### Changed
- The default CLI help now shows the core Hivelore workflow first: init, doctor, agent setup, briefing, enforcement, sync, session recaps, and high-signal memory commands.
- Maintenance and experimental CLI commands remain callable but are hidden from default help; use `hivelore --advanced --help`, `hivelore --advanced memory --help`, or `HAIVE_SHOW_ADVANCED=1` to show the broader surface.
- The `maintenance` MCP profile exposes lifecycle, review, lint/distill, import-adjacent, and code-search tools without enabling runtime journal, pattern detection, or exploratory why/conflict diagnostics.

## [0.9.15] — harness diagnostics and quieter enforcement

### Added
- Added install/version diagnostics to `hivelore doctor` and `hivelore enforce status` for stale absolute Hivelore binaries in hooks and MCP configs.
- Added `why` explanations to `get_briefing` memory results so agents can see why each context record was surfaced.
- Added glob-style anchor matching (`*`, `**`, `?`) and directory-symbol verification for broader module/pattern policies.

### Changed
- `pre_commit_check` now classifies anti-pattern matches as `blocking`, `review`, or `info`, with rationale text; the CLI hides weak FYI matches by default.
- The default MCP enforcement profile now includes `mem_tried`, `mem_get`, and `code_map` as focused core workflow tools.
- `hivelore memory lint` now flags low-actionability records, never-read validated records, and near-duplicate records.

## [0.9.14] — repo-native context enforcement positioning

### Changed
- Repositioned npm- and GitHub-facing docs around repo-native context enforcement instead of persistent memory.
- Updated README terminology to describe Hivelore records as enforceable context breadcrumbs for AI agents.
- Refreshed package metadata and VS Code extension wording around policy, breadcrumbs, and context enforcement.

## [0.9.13] — enforcement false-positive fixes

### Fixed
- Session recap updates now refresh `verified_at`, so strict gates count an updated recap as recent without rewriting its original creation date.
- `hivelore enforce` now checks recap freshness using `verified_at ?? created_at`.
- `pre_commit_check` no longer blocks `high-confidence` mode on literal-only or anchor-only anti-pattern matches; blocking now requires a strong semantic signal.

### Changed
- `hivelore precommit` now reports blocking anti-pattern warnings separately from advisory anti-pattern matches.

## [0.9.12] — agent-aware init and setup

### Added
- Added `hivelore agent detect/status/setup` to choose between native MCP, wrapped, and CLI fallback modes per machine.
- `hivelore init` now runs agent-aware setup, writes project MCP configs, records `.ai/.runtime/enforcement/agent-mode.json`, and asks before changing user-level AI client configs.
- Added Codex CLI MCP setup support via `codex mcp add haive ...` when Codex is detected and the user approves global setup.

## [0.9.11] — enforcement scoring and agent benchmark reports

### Added
- Added enforcement scoring to `hivelore enforce check/status/ci`, including configurable score thresholds.
- Added decision coverage checks: changed files now require relevant anchored decisions/gotchas/conventions to be surfaced in the latest briefing.
- Added `hivelore enforce cleanup` for generated `.ai/.cache` and `.ai/.runtime` artifacts.
- Added `hivelore benchmark demo` and `hivelore benchmark report` to make Hivelore-vs-plain agent trials a repeatable product demo.

### Changed
- Tightened the default MCP enforcement profile to the core workflow tools: briefing, memory save/search/verify/relevance, pre-commit check, and session recap.
- Briefing markers now record surfaced memory IDs and target files, allowing enforcement to verify that the right decisions were consulted.

## [0.9.10] — npm positioning and enforcement narrative

### Changed
- Reframed npm-facing documentation and package metadata around Hivelore as an AI-agent policy enforcement layer, with persistent memory described as the mechanism rather than the headline.

## [0.9.9] — agent-agnostic enforcement and `hivelore run`

### Added
- Added agent-agnostic enforcement commands: `hivelore enforce install`, `hivelore enforce status`, `hivelore enforce check`, and `hivelore enforce ci`.
- Added `hivelore run -- <agent command>` to wrap any CLI-based coding agent in a Hivelore-enforced session with `HAIVE_PROJECT_ROOT`, `HAIVE_SESSION_ID`, and strict enforcement env vars.
- Added a blocking GitHub Actions enforcement workflow template generated by `hivelore enforce install`.
- Added strict enforcement config fields for briefing, session recap, memory verification, stale-decision blocking, and mode selection.

### Changed
- `hivelore briefing` now writes a local briefing marker, so CLI-first agents can satisfy the same enforcement gate as hook-based agents.
- Autopilot `hivelore init` now installs agent-agnostic enforcement gates instead of only Claude Code hooks.
- Git hooks installed by Hivelore are now blocking workflow gates by default, not advisory reminders.

## [0.9.8] — enforcement hooks and default MCP profile

### Added
- Added Hivelore enforcement mode as the default MCP profile for initialized projects: the default MCP surface is now the smaller enforcement set, with `HAIVE_TOOL_PROFILE=full` available for the legacy full tool list.
- Added `hivelore enforce session-start` and `hivelore enforce pre-tool-use` for agent hooks. Claude Code hooks can now inject a briefing marker at session start and block write-like tools until briefing is loaded.
- Added `.ai/.runtime/enforcement/briefings/` marker support for local pre-edit enforcement.

### Changed
- `hivelore install-hooks claude` now installs `SessionStart`, `PreToolUse`, `PostToolUse`, and `SessionEnd` hooks instead of passive capture only.
- Autopilot `hivelore init` installs project-scoped Claude Code enforcement hooks when possible.

## [0.9.7] — enforcement direction and release hygiene

### Fixed
- Aligned the root package version and project context version with the publishable package line.
- Added consistent `shared` scope path support for memory file resolution.
- Restored full `pnpm -r typecheck` health across core, CLI, MCP, embeddings, VS Code, and GitHub Action packages.
- Updated CLI/MCP call sites for current `code_map` and embeddings APIs.

### Added
- Added an enforcement strategy plan for narrowing Hivelore around briefing gates, PR guardrails, and a smaller default MCP tool surface.

## [0.2.0] — token-aware briefing, code map, sync hooks

### Added — token reduction
- **`get_briefing` MCP tool**: one-shot onboarding that bundles project
  context + module contexts + ranked relevant memories under a token budget.
  Replaces 4–5 separate calls (`get_project_context`, `mem_for_files`,
  `mem_search` literal, `mem_search` semantic) and dedupes results
  ranked by reason (anchor / module / semantic / domain) and confidence.
- **Code map** (`hivelore index code` → `.ai/code-map.json`): static parse of
  TS/JS exports per file with JSDoc-derived 1-line descriptions. AIs read
  the map (~30KB on this repo) instead of greping 30+ files. Exposed as
  the `code_map` MCP tool with file/symbol filters.
- **Token budget helpers** in `@hivelore/core`: `estimateTokens`,
  `truncateToTokens` (head/tail/middle), `allocateBudget` distributes a
  global budget across weighted parts and re-allocates surplus from
  small parts to larger ones.

### Added — sync on merge / near-realtime
- **`hivelore sync`**: refreshes anchor verification + auto-promotion in
  one command. `--since <ref>` reports memories added/modified/removed
  vs a git ref. `--quiet` for hooks.
- **`hivelore install-hooks`**: writes `.git/hooks/post-merge` and
  `post-rewrite` that run `hivelore sync --quiet --since ORIG_HEAD` so
  every pull/merge updates memory state automatically.
- **GitHub Action template** at `.github/workflows/haive-sync.yml.example`:
  on push to main/develop, runs sync and commits any state updates;
  on PR, comments if memories anchored in the diff would become stale.

### Added — quality of life
- **`hivelore memory hot [--threshold N]`**: surfaces drafts/proposed
  memories with `read_count >= N` — the natural promotion candidates.
- **Auto-tag on `memory add`**: tags inferred from anchor paths
  (e.g. anchoring `packages/mcp/...` adds tag `mcp`). Disable with
  `--no-auto-tag`.

### Changed
- **Improved literal `mem_search`**: queries now also match against
  anchor path basenames + segments, anchor symbols, module, and
  domain — not just id/tags/body. Multi-token queries still AND
  across all fields.
- **Improved `mem_for_files`**: surfaces memories where any tag
  matches an inferred module name, not only memories with the
  `module` field set.

### Tests
- 120 passing total (79 core + 17 embeddings + 16 mcp + 8 cli).

## [0.1.1] — security: drop heavy ML chain from default install

- **Breaking install behavior** : `@hivelore/embeddings` was an
  `optionalDependency` of `@hivelore/cli` and `@hivelore/mcp`, which means
  npm pulled it (and its full Transformers.js / onnxruntime / sharp
  dependency tree) on every install — bringing in 35 known
  vulnerabilities including a critical one (`protobufjs <7.5.5`,
  GHSA-xq3m-2v4x-88gg, via `onnx-proto`).
- It is now a `peerDependency` with `optional: true`. End users who
  do not need semantic search no longer pull the ML chain, going from
  ~150 transitive packages to ~20.
- Users who do want semantic search install it explicitly:
  `npm install @hivelore/embeddings`. The CLI/MCP code already lazy-imports
  it, so behavior is unchanged when present.
- Added a `protobufjs >=7.5.5` override at the workspace and embeddings
  package level to patch the critical vuln even when the ML chain is
  installed. `pnpm audit --prod` reports zero known vulnerabilities.

### Added — v0.4 (foundation cycle: real-world testing, staleness, validation, relevance, CRUD, review)

- **A. Real-world MCP integration.** Project-scoped `.mcp.json` so Claude
  Code auto-detects the local server. Multi-word literal `mem_search` (token
  AND across id/tags/body, case-insensitive) extracted to `@hivelore/core` and
  shared by CLI and MCP.
- **B. Staleness detection.** `verifyAnchor` checks that `anchor.paths`
  exist and `anchor.symbols` are still present in those files; `hivelore
  memory verify [--id X | --all] [--update]` and the `mem_verify` MCP tool
  optionally write back `status=stale` with `verified_at` and
  `stale_reason` to the frontmatter.
- **C. Passive validation + confidence levels.** Per-memory usage tracked
  in a sidecar (`.ai/.cache/usage.json`, gitignored). `mem_search` increments
  `read_count` and returns a derived `confidence` (`unverified | low | trusted
  | authoritative | stale`). New `mem_reject` tool / `hivelore memory reject`
  command records explicit rejections. `hivelore memory auto-promote
  [--min-reads N] [--max-rejections N] [--apply]` lifts proposed memories
  to validated based on real use.
- **D. Module-aware auto-loading.** `mem_for_files <files...>` infers
  modules from conventional layouts (`packages/`, `apps/`, `modules/`,
  `src/`) and returns relevant memories grouped by reason (anchor overlap,
  module match, domain match) plus inlined module-context files.
- **F. CRUD completeness.** `hivelore memory show / edit / rm` and the
  `mem_get` / `mem_delete` MCP tools.
- **E. Light memory PR workflow.** `hivelore memory pending` lists
  proposed memories awaiting review, sorted by reads desc; `hivelore memory
  approve <id>` and the `mem_approve` MCP tool perform an explicit review.

### Changed
- `mem_search` and `mem_list` now expose `confidence` and `read_count` on
  every hit; `mem_search` accepts a `track: false` opt-out.
- `@hivelore/embeddings` is now an `optionalDependency` of `@hivelore/mcp` so
  semantic mode works out of the box when the package is installed.

### Tests
- 105 passing (64 core / 17 embeddings / 16 mcp / 8 cli).

## [v0.3] — local embeddings + semantic search

- New `@hivelore/embeddings` package built on Transformers.js
  (`Xenova/bge-small-en-v1.5`, 384 dims), runs entirely locally.
- CLI: `hivelore embeddings index | query | status`. MCP: `mem_search` gains
  `semantic` + `min_score`, with graceful literal fallback when the index
  or package is missing.
- Cache at `.ai/.cache/embeddings/embeddings-index.json` with per-entry
  SHA-256 invalidation.

## [v0.2] — MCP server

- `@hivelore/mcp` (stdio) exposes 5 tools (`mem_save`, `mem_search`,
  `mem_list`, `get_project_context`, `bootstrap_project_save`) plus the
  `bootstrap_project` prompt. Bin `haive-mcp` and CLI command `hivelore mcp`.

## [v0.1] — foundations

- Monorepo (pnpm workspaces, Node 20 LTS, `tsup`, `vitest`).
- `@hivelore/core` memory schema (zod) + frontmatter parser/serializer + path
  resolution + recursive loader.
- `@hivelore/cli` first commands: `hivelore init`, `hivelore memory add | list |
  query | promote`. Approach B (Personal first): new memories default to
  `personal`; explicit `promote` is the only way into `team`.
