# Changelog

All notable changes to hAIve are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and the
project follows semantic versioning once it ships its first stable release.

## [Unreleased]

## [0.26.2] — native bridges become non-destructive managed blocks

#### Added
- Native bridge files now carry a full `haive:bridge-start/end` managed block, so hAIve can refresh
  its generated instructions/memories without owning the whole native file.
- `haive bridges status` reports each target as managed, legacy-managed, unmanaged, missing, stale, or
  invalid; `bridges list` remains an alias.

#### Fixed
- `haive bridges sync` now skips files with broken or duplicated hAIve markers instead of appending or
  overwriting ambiguously. Existing human content outside hAIve markers is preserved.
- `haive sync` uses the same bridge writer for existing native bridge files, including `AGENTS.md` and
  `CLAUDE.md`, eliminating drift between the legacy `--inject-bridge` path and native bridge sync.

## [0.26.1] — catch SonarQube stylistic/naming rules in the ingest quality floor

#### Fixed
- SonarQube uses numeric rule keys (`typescript:S103`, `python:S00117`), so the name-based stylistic
  denylist missed them. Added a curated set of Sonar formatting/naming/trivial-maintainability keys
  (S100/S101/S103/S105/S113/S114–S122/S125/S1110/S1116/S1131/S1542), normalized so legacy (`S00117`)
  and modern (`S117`) ids both match. Real security/quality rules (S2068 hard-coded creds, S5852 ReDoS,
  S1234 cognitive complexity) are untouched. Live-verified: `haive ingest --from sonar` on 5 findings →
  3 stylistic filtered, 2 security rules kept.

## [0.26.0] — quality floor for ingested findings and git seeds; flaky-test hardening

#### Added
- **Source-appropriate quality gates for the two remaining cold-start sources.** Calibration showed the
  specificity floor is the wrong tool for them (a finding body is always concrete → passes; a git-seed
  body is mostly boilerplate → fails), so each source gets its own gate:
  - **ingest** drops auto-fixable **stylistic** rules (semi/quotes/indent/prefer-const/prettier…),
    matched on the rule's last segment so prefixed ids count. `haive ingest --include-stylistic`
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
- **`haive coverage` crosses the corpus with both committed git churn AND agent-edited hot files** from
  the PostToolUse observation log (`.ai/.cache/observations.jsonl`), merged and tagged per gap with its
  heat source (`git` | `agent` | `both`). New `--source git|agent|both`.
- **Conflict resolution is now a guided supersede, not just a deprecate.** `applyConflictResolution`
  promotes the winner (revision_count++, verified, linked) and has it adopt the loser's topic when it had
  none — so future `mem_save` upserts consolidate into the winner instead of spawning a third
  contradiction. `haive memory resolve-conflict --yes` writes both files; `mem_conflict_candidates`
  attaches a `suggested_resolution` (keep/supersede + apply command) to every pair.

## [0.22.0] — close the prevention-recording leak in the installed gate

Perfecting the existing loop (capture → brief → block → measure) before adding anything new; grounded in
a code-verified harness-engineering audit that found the headline "measure" leg leaked.

#### Fixed
- **`recordPreventionHits` is now THE single prevention recorder.** The git-hook gate, `haive sensors
  check`, and the anti-pattern MCP tool funnel through it (debounced), so what the installed gate
  **blocks** is finally **counted**. The regex/command-sensor path used to block without recording; only
  anti-pattern catches were recorded before.

#### Added
- `runSensorGate` records prevention for regex AND command sensors in the git-hook gate; shell/test
  command sensors run in-gate behind `enforcement.runCommandSensors`.
- `mem_tried` returns `sensor_generated` + a hint when the ratchet stays open (no paths / no distinctive
  token), so a paths-less capture isn't silently advisory-only.
- `haive eval` reports case provenance (synthesized vs authored) and warns when the score is purely
  self-referential.

## [0.21.0] — pre-commit gate auto-briefs; `haive briefing --json`

#### Added
- **Auto-brief:** the pre-commit/pre-push decision-coverage gate no longer blocks waiting for a manual
  `haive briefing` — it surfaces the relevant anchored decisions itself and records them in the session
  marker at commit time, then passes with `decision-coverage-autosurfaced`. New `enforcement.autoBrief`
  (default true); set false for the strict legacy gate.
- **`haive briefing --json`** emits the ranked memories + quality + counts (parity with the MCP
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
  (fuzzy anti-pattern matcher), while `haive eval` reported `catch_rate 1.0` — real commits had zero
  sensor protection. `runPrecommitPolicy` now runs `runSensorGate` (all regex sensors, any memory type)
  on the staged diff: block sensor → fails the gate, warn sensor → visible non-blocking finding.
- **Tightened fuzzy precision:** a non-anchored memory whose sensor did NOT fire → info (non-violation
  evidence); uncorroborated semantic review floor 0.6 → 0.65. Cuts the "20 mostly-irrelevant matches for
  a 3-line diff" noise that trains agents to ignore the gate.
- `memory-lint` `LOW_VALUE_GUESSABLE` now requires positive generic-advice evidence so an
  arbitrary-but-prose team policy isn't mislabeled.

## [0.19.0] — `haive init` generates all 12 native bridges, carrying memories + sensors

#### Changed
- A fresh `init` now produces **every** supported bridge via the shared generator, **after** seeding, so
  each carries the repo's memories + block sensors (before, init reached ~4 agents with an empty static
  template). New `--bridge-targets <all|comma-list>` (default all); `--no-bridges` still skips. The
  first-session report shows "Reach: N agent bridge(s) generated".
- The `HAIVE_PREAMBLE` shared by every bridge is upgraded to the full instructional body (repo map +
  4-step "Working through hAIve" + Safety). Generic stack-pack memories stay **out** of bridges
  (on-thesis — bridges stay repo-specific + enforced rules).

## [0.18.0] — 12 bridge targets, +10 stack packs, eslint/npm-audit ingest

Closes the two adoption levers from the battle plan (reach + cold-start) where hAIve was "good, not
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
- **`haive ingest --from eslint|npm-audit`:** ESLint JSON (cwd-relativized paths + derived sensor) and
  `npm audit` JSON (anchored to package.json).
- **seed-git:** new `workaround` signal (workaround/hack/band-aid/FIXME/stop-gap).

## [0.17.1] — cold-start metric integrity + proof-line wiring

Integration pass after merging Lot A (cold-start), Lot B (visible value), and Lot C (reach).

#### Fixed
- **No more fabricated "prevented mistake" events on the first post-init commit.** The anti-pattern
  gate's self-match guard only excluded `.ai/`; the same commit also stages every file
  `haive init` / `haive bridges` generate (AGENTS.md, CLAUDE.md, `.cursorrules`, `.clinerules`,
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
- **`cli/commands/bridges.ts`** — `haive bridges sync` command. Idempotent (marker-based),
  supports `--all`, `--only <targets>`, `--max-memories`, `--dry-run`.
  Also exposes `haive bridges list` to show target status.
- **`BRIDGE_TARGETS`, `BRIDGE_TARGET_PATH`, `BRIDGE_MARKERS`** exported from `@hiveai/core`
  for use by Lot A (`init.ts` can call `generateBridges()` at init time — C6 interface).
- **C5 hook point**: `get-briefing.ts` now has a documented insertion comment for
  `briefingProofLine()` from Lot B (when that function is ready, import and wire it there).
- Tests: `packages/core/test/bridges.test.ts` — unit + per-target snapshot tests.

## [0.17.0] — one shared briefing-priority classifier (kill the CLI/MCP drift)

The must_read / useful / background tier was implemented **twice** — in the MCP `get_briefing` tool and
in the `haive briefing` CLI command — each on its own data shape. They drifted: the stack-pack
down-rank and then the env-workaround down-rank each had to be added in two places, and one was missed.
This extracts the single source of truth.

### Changed
- **New `@hiveai/core` `priority` module** owns `classifyMemoryPriority(signals)` + `priorityRank`.
  Both call sites now map their evidence (MCP: semantic scores; CLI: lexical scores) into a normalized
  `PrioritySignals` and call the same classifier, so the CLI and MCP can never disagree again.
- **MCP behavior is byte-for-byte preserved** (the `get_briefing` priority tests pass unchanged). The
  CLI gains the consistency wins it was missing: `requires_human_approval`, direct **symbol** matches,
  and exact **skill** hits now rank `must_read` in `haive briefing` too, matching the MCP path.
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
- **Fixed a CLI/MCP ranking drift:** `haive briefing`'s own priority classifier mirrored the stack-pack
  down-rank but missed the new env-workaround one, so the two façades disagreed. The CLI now also caps
  env-workaround memories at `background` (verified live: the install/hot-swap notes now render
  `[background]`). Same dual-renderer drift class as the recap fix — a shared classifier is overdue.
- **Fixed an anti-pattern self-match false positive:** editing a memory's own backing file (e.g.
  re-tagging an `attempt` whose body documents `npm install -g`) re-emitted the bad pattern into the
  diff, and the gate matched the memory against *its own file* and hard-blocked. `anti-patterns-check`
  now strips `.ai/` hunks before literal/semantic matching — knowledge-base edits can't corroborate
  "you reintroduced a bad pattern in code". Surfaced by dogfooding this very release.

## [0.16.0] — friction polish from real usage (dogfooding feedback)

After driving hAIve end-to-end to ship 0.15.0, six concrete friction/noise points surfaced from
*actual use*. This release fixes the things that wasted time or trained the user to ignore the
harness — finishing the existing, not adding scope.

### Changed
- **Decision-coverage now accumulates across briefings.** `writeBriefingMarker` unions `memory_ids`
  and `files` with the session's existing fresh marker instead of overwriting. Every `get_briefing`,
  every pre-edit injection, and every `haive briefing` now ADDS to the consulted set — so a broad
  commit no longer demands one giant briefing covering every relevant decision at once. This was the
  #1 friction (a documented recurring gotcha). Pass `accumulate: false` to reset for a new session.
- **Failure detection no longer cries wolf.** `haive observe` no longer flags a bare non-zero exit
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
  `get_briefing` (MCP) and `haive briefing` (CLI).
- **Correct git-tag push advice.** `CLAUDE.md` and the release findings now recommend
  `git push origin vX.Y.Z` instead of `git push --tags` (which fails on pre-existing divergent tags).

### Notes
- New pure core helpers with unit tests: `recap` (`isAutoRecap`/`compactAutoRecapBody`),
  `isEnvWorkaroundMemory`, and `writeBriefingMarker` accumulation. CLI `detectFailure`/
  `isExpectedNonzeroExit` are now exported and tested.

## [0.15.0] — perfect the existing harness (harness-engineering gap closure P0–P3)

A grounded analysis of hAIve against the harness-engineering literature (Fowler/Böckeler, LangChain,
Addy Osmani, awesome-harness-engineering) surfaced eight *real* gaps — verified in code, not on the
surface. This release closes all eight, finishing features the schema/UX already promised rather than
adding new scope.

### Added
- **P0-1 — executable shell/test sensors.** The schema reserved `kind: "shell" | "test"` but never ran
  them. `haive sensors check --commands` (or `enforcement.runCommandSensors: true`) now executes a
  memory's sensor command and treats a non-zero exit as a hit — turning lessons a regex can't express
  into real deterministic guardrails. Off by default (runs repo-authored commands).
- **P0-2 — failure-capture gate.** `haive enforce finish` now reads the session's `failure_hint`
  observations and flags hard failures that were never written down as a lesson. Advisory by default
  (`enforcement.failureCaptureGate: off | warn | block`) — the ratchet that stops silent re-introductions.
- **P1-3 — `haive coverage`.** Crosses the repo's hottest files (git churn) with the memory corpus to
  surface frequently-edited files with no covering memory — the harness blind spots. The inverse of
  `haive eval` (which checks the memories that exist surface correctly).
- **P1-4 — eval score trend + CI record.** `haive eval --record` appends each run's score to a history
  log; `haive eval --trend` renders a sparkline (latest/best/Δ). The generated CI gate now records and
  trends the score, so a harness-quality regression is a number, not a vibe.
- **P2-5 — `haive memory resolve-conflict`.** Turns a detected contradiction into a resolution:
  deterministically keeps the stronger memory (status → revision_count → recency) and deprecates the
  other. Detection existed; this applies the fix.
- **P2-6 — gate precision in the dashboard.** A new rollup shows whether the inferential anti-pattern
  gate's catches are real (useful) or noise (rejected), and suggests tightening/loosening
  `enforcement.antiPatternGate` accordingly.
- **P3-7 — `haive memory seed-git`.** Cold-starts the corpus by proposing draft `attempt` seeds from
  revert/hotfix commits in git history — zero manual authoring on a fresh/legacy repo.
- **P3-8 — `haive merge-driver`.** A deterministic git merge driver for memory files: collisions under
  `.ai/memories/` resolve by `revision_count → created_at` instead of leaving `<<<<<<<` markers.
  `haive merge-driver install` wires git config + `.gitattributes`.

### Notes
- All new computational layers are pure functions in `@hiveai/core` (`coverage`, `failure-coverage`,
  `eval-history`, `conflict-resolve`, `gate-precision`, `seed-git`, `merge-memory`) with unit tests;
  the CLI orchestrates I/O around them. Out of scope (deliberately): the behaviour harness (test
  generation/verification) — hAIve complements tests, it does not replace them.

## [0.14.0] — make the harness helpful, not a burden (friction P0–P3)

The exit machinery and outcome metrics are solid; the *entry* friction was the thing that would make
an agent (or human) stop using hAIve. This release attacks that directly — surface context, don't
block; and trim what wastes time.

### Changed
- **P0 — the pre-edit gate now ADVISES by default instead of blocking.** When you edit a file whose
  anchored team policy wasn't surfaced yet, the PreToolUse hook now *injects that memory's content
  into the agent's context* (via `additionalContext`) and **allows the edit** — no round-trip, no
  separate `haive briefing` command. It also records the policy into the briefing marker, so the
  commit-time decision-coverage gate accumulates coverage as you edit. Set
  `{ "enforcement": { "preEditGate": "block" } }` to keep the strict behaviour (which now also
  records context, so a simple re-issue of the edit passes — still no briefing command).
  The commit gate and CI enforcement remain the hard backstops.
- **P0 — decision-coverage ignores hAIve-generated artifacts** (`.ai/project-context.md`,
  `.ai/code-map.json`, `.ai/.cache|.runtime|.usage/`). They are tool-generated, not human decisions,
  and were the cause of release commits being blocked over a repair-touched file.
- **P2 — `get_briefing` no longer re-emits an unchanged project context** within a short window
  (8 min). The first call sends it and records a content-hash marker; repeats omit it with a short
  notice (the agent already has it). Pass `dedupe_project_context: false` to force a full copy. Saves
  ~1.5k tokens per repeat briefing in a long session.

### Added
- **P3 — `haive dev link`** codifies the dist→global hot-swap (including the nested `@hiveai/core`
  copies pnpm requires), so working on hAIve itself no longer needs a copy-paste shell snippet or an
  npm publish to test enforcement/MCP/hook changes against the real `haive` binary.
- New `enforcement.preEditGate: "advise" | "block"` config (default `advise`).

### Notes
- **P1 — diff-scan layers are now documented in-place.** `sensors check` (regex) and
  `anti_patterns_check` (memory match) are components; `pre_commit_check` combines them; `haive
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
  (gitignored telemetry, never committed). `haive dashboard` now shows a **trend** (catches in the
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
- **`commit-msg` hook that PREVENTS the skip-ci footgun.** `haive enforce install` now installs a
  `commit-msg` hook (and a `haive enforce commit-msg <file>` command) that blocks a commit whose
  message contains a CI-skip directive ([skip ci] / [ci skip] / [no ci]) **when the commit also
  changes shippable code** — GitHub scans the whole message and would skip CI for the entire push.
  `.ai/`-only sync commits (which legitimately use [skip ci]) are allowed, and `#` comment lines are
  ignored. This is the preventive counterpart to 0.13.7's post-hoc detection.
- **Outcome measurement — prevention events.** A new `prevented_count` / `last_prevented_at` usage
  signal records when a memory's sensor actually fires on a scanned diff (`haive sensors check`),
  i.e. the encoded lesson intercepted a known mistake before it landed. This is hAIve's first true
  OUTCOME metric (defect prevented), distinct from retrieval (reads) and self-reported usefulness
  (applied). Recording is debounced (5 min) so re-scanning the same diff doesn't inflate counts.
- **`haive dashboard` now shows a Prevention section** (total catch events, memories with catches,
  top memories by catches), and `computeImpact` folds `prevented_count` in as a top-tier
  demonstrated-value signal (3 catches can reach "high" on their own, like applied outcomes).

## [0.13.7] — release/enforcement reliability hardening

Five fixes to the exit machinery — the brittle, footgun-prone part that lands every change.
Driven by friction hit firsthand while shipping 0.13.2–0.13.5.

### Fixed
- **A — `haive briefing` now records the anchored-policy memory ids in the briefing marker.**
  The decision-coverage gate suggests "Run `haive briefing --files …`" as its fix, but the CLI
  briefing wrote a marker with no `memory_ids`, so the suggested command never unblocked the gate
  (only the MCP `get_briefing` did). The CLI briefing now writes exactly the validated policy
  memories anchored to the requested files, using the same match function the gate uses — so the
  fix the tool proposes is the fix that unblocks. CLI/MCP briefing are now at parity here.
- **B — the atomic pre-commit staging is generalized** beyond `project-context.md` to every tracked
  `.ai/` file the lightweight repair re-synced (auto-promoted/re-validated memories, code-map),
  excluding machine-local telemetry (`.usage`/`.runtime`/`.cache`). Closes the general case of a
  later `chore: haive sync` tip skipping CI, not just the version-header case.
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
  hAIve-vs-plain agent value. Both descriptions now state the distinction explicitly.
- **Phase D — `install-hooks` and `precommit` are labelled as `enforce` equivalents** in their help
  (`install-hooks` = `enforce install`, `precommit` = `enforce check --stage pre-commit`), so the
  overlap is discoverable instead of confusing. Kept as-is (non-breaking); `enforce` remains canonical.
- **Phase E — the advanced surface is now grouped by family in `haive --advanced --help`**
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
  ran *after* staging), so the `haive-sync` workflow committed a `chore: haive sync [skip ci]` tip on
  top of the release — which skips CI for the whole push. Now the re-synced header lands in the release
  commit itself, keeping the release commit the push tip (decision
  `2026-06-02-decision-atomic-release-commit-and-skip-ci-tip`). Best-effort and scoped to the
  project-context file, so telemetry churn (the tool-usage log) still flows through a later sync.

## [0.13.3] — golden path made visible (harness coherence, Phase B)

### Changed
- **`haive --help` now documents the golden path** — the day-to-day workflow
  (`init → doctor → agent setup → briefing → memory save/tried → sensors check → enforce finish → sync → session end`)
  and the CLI↔MCP verb parity (`memory save/search/get/delete ↔ mem_save/mem_search/mem_get/mem_delete`,
  old verbs still aliased). Makes the already-existing focused surface (core commands visible by default,
  the rest one `--advanced` away) explicit instead of implicit.
- **README**: new "CLI at a glance — the golden path" section with the ~11 core commands grouped by
  lifecycle stage and the verb-parity note. Phase B of `docs/HARNESS-COHERENCE-MAP-2026-06.md`.

## [0.13.2] — CLI verbs aligned with MCP tool names (harness coherence, Phase A)

### Changed
- **`haive memory` verbs now mirror the MCP tool names** so an agent learns one vocabulary across
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
- **`haive init` now wires `haive eval --regression-gate` into the generated CI** (a `pr-eval-gate`
  job in `haive-sync.yml`, runs on pull requests). It fails a PR only when the harness quality score
  drops vs the committed `.ai/eval/baseline.json`, and is a **no-op when no baseline exists** — so it
  is safe to ship enabled by default and needs nothing external (no secrets, no services). Create a
  baseline with `haive eval --baseline` to turn the gate on.

## [0.13.0] — portable extensions (Sonar live-fetch, regression gate, more packs)

> Design principle reinforced this release: **every hAIve tool works standalone**. No command
> requires an external service or a specific local setup; optional integrations degrade gracefully
> with one clear message and never crash. See decision
> `2026-06-02-decision-tools-must-be-environment-independent`.

### Added
- **`haive ingest --from sonar-api`** — fetch open issues live from any SonarQube/SonarCloud
  instance over plain HTTPS (Node built-in `fetch`), with `--sonar-url` / `--sonar-token` /
  `--sonar-component` (or `SONAR_HOST_URL` / `SONAR_TOKEN`). **No MCP or special setup required** —
  if creds are absent it prints one actionable message and exits; file-based `--from sonar|sarif`
  always works regardless.
- **`haive eval --regression-gate`** — CI-safe quality gate: compares against the baseline IF one
  exists (failing on a score regression) and otherwise no-ops (exit 0), so it can be dropped into any
  pipeline unconditionally.
- **Three new stack packs** — `flask`, `vue`, `spring` — with curated sensors (flask
  `app.run(debug=True)`, vue `v-html` XSS, spring wildcard `@CrossOrigin`).

## [0.12.9] — eval baseline & delta reporting

### Added
- **`haive eval --baseline`** snapshots the current report to `.ai/eval/baseline.json`, and
  **`haive eval --compare`** re-runs and prints the per-metric delta (overall score, mean recall,
  MRR, sensor catch-rate) with an IMPROVED / REGRESSED / UNCHANGED verdict — making the "hAIve
  improves agent retrieval by N%" claim reproducible.
- **`--fail-on-regression`** turns a score drop vs the baseline into a non-zero exit for CI gates;
  **`--baseline-file <path>`** overrides the default location.
- New pure `compareEvalReports` / `EvalDelta` in `core/eval.ts` (CLI does the I/O).

## [0.12.8] — AGENTS.md portable bridge

### Added
- **`haive init` now emits `AGENTS.md`** (the emerging cross-harness convention used by Codex and
  others) alongside CLAUDE.md / .cursorrules / copilot-instructions.md, so the `.ai/` corpus is
  consumable by any AGENTS.md-aware agent — not just Claude.
- **`haive sync --inject-bridge` injects the memory breadcrumbs into both CLAUDE.md and AGENTS.md**
  by default (when present). An explicit `--bridge-file` still targets a single file.

## [0.12.7] — stack packs with executable sensors + backend packs

### Added
- **Stack-pack memories can now carry a curated regex `sensor`** — seeded templates become
  feedforward+feedback guardrails (the lesson fires deterministically on the user's own diff, not
  just when the briefing surfaces it). Seed sensors are `warn` + `autogen:false` (vetted; never
  auto-block).
- Crisp sensors added to high-signal existing packs: Next.js `NEXT_PUBLIC_*` secret leak, React
  `key={index}`.
- **Three new backend stack packs**: `fastapi`, `django`, `go` (seed via `haive init --stack
  fastapi,django,go`). Carry sensors where a precise pattern exists — django `DEBUG = True` and
  hardcoded `SECRET_KEY`, fastapi `uvicorn reload=True` and bare `except:`.

## [0.12.6] — observability dashboard

### Added
- **`haive dashboard` (+ `--json`)** — a non-interactive, scriptable observability snapshot of the
  memory corpus that an agent or CI job can read in one shot (unlike `haive tui`, which needs a TTY).
  Surfaces: inventory (by scope/type/status, active vs retired), impact tiers + the top memories by
  demonstrated utility, sensors (totals by severity + which ones actually fired), health (stale /
  anchorless / pending / prune candidates), decay (>90d), and corpus token weight.
- New pure core module `dashboard.ts` (`buildDashboard`) aggregating the existing impact, usage,
  sensor, retirement and decay primitives. No I/O — unit-tested in `core/test/dashboard.test.ts`.

## [0.12.5] — findings ingestion (self-feeding sensors)

### Added
- **`haive ingest` + `ingest_findings` MCP tool** — turn scanner findings (SonarQube issues JSON
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
  Ingestion never auto-validates and never auto-blocks — a human reviews (`haive memory pending`)
  and promotes (`haive sensors promote <id> --yes`).

### Docs
- `docs/HARNESS-ROADMAP-2026-06.md` — reconciles a harness-engineering research wishlist against the
  actual codebase (most points already shipped) and sets the execution order; findings ingestion (B)
  was the one genuine gap and is delivered here.

## [0.12.4] — pipeline-aware finish gate

### Added
- **`haive enforce finish` now verifies GitHub Actions before agents close a task.** When the
  pushed HEAD has a GitHub remote, the finish gate checks `gh run list --commit <sha>` and blocks
  on missing, pending, failed, cancelled, or otherwise non-successful workflow runs.
- Added agent-facing closeout guidance in the post-task prompt, generated hAIve bridge rules, and
  the team close-session skill so future agents know that remote pipeline success is part of the
  exit protocol.

## [0.12.3] — CI decision coverage runner fix

### Fixed
- **`haive enforce ci` no longer fails on local-only briefing markers.** GitHub Actions does not
  have the agent's `.ai/.runtime/enforcement/briefings` marker after push, so CI now reconstructs
  decision coverage from the committed diff and reports `decision-coverage-ci-pass` instead of
  blocking with `decision-coverage-missing`. Local/pre-commit/pre-push gates still require the
  real briefing marker.

## [0.12.2] — quality gate and doctor excellence pass

### Added
- **Repo-native eval specs** — `haive eval` now auto-loads `.ai/eval/spec.json` when present and
  merges those labeled cases with synthesized anchored-memory retrieval cases. hAIve's own CI now
  exercises eight executable sensor cases, so the 0–100 score covers retrieval and guardrail catch-rate.
- **Sharper setup diagnostics** — `haive doctor` now reports missing local `pnpm`, stale or missing
  workspace `dist` artifacts, and dist/source version mismatch as explicit actionable findings.
- **Architecture coverage memories** — core, CLI, and MCP package boundaries are documented as anchored
  team memories so harness coverage reflects real module policy instead of generic advice.

### Improved
- Low-value generic workflow memories were rewritten as concrete hAIve release/toolchain policies,
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
  Measured with `haive eval`: semantic-only retrieval **19 → 98**, anchored **95 → 100**
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
- **`haive memory feedback <id> --applied|--rejected`** — CLI mirror of the `mem_feedback`
  MCP tool, closing the impact loop from the terminal.
- **`haive memory add --activation-keyword/--activation-glob/--activation-always`** — author
  skill progressive-disclosure triggers from the CLI.
- **`haive eval --fail-under <score>`** — non-zero exit below the threshold; wired into CI
  (`ci.yml`) so a briefing-retrieval or sensor-catch-rate regression fails the build.

## [0.11.0] — impact-aware ranking, eval harness, skill activation

### Added
- **Impact-aware briefing ranking** — `get_briefing` (and `mem_relevant_to`) now factor a
  memory's demonstrated-utility score into ranking: a memory agents actually applied, or whose
  sensor caught a regression, edges out an equally-relevant one that never proved useful. The
  nudge is small by design and never overrides anchor/symbol relevance. `impact_score` /
  `impact_tier` are surfaced on each briefing memory for transparency.
- **`haive eval`** — a rigorous, model-free, CI-runnable quality eval. Measures briefing
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
- **Memory impact scoring** — new pure `computeImpact` (in `@hiveai/core`) combines the utility
  signals hAIve already recorded but never correlated: reads + applied outcomes + a sensor that
  actually fired (positive) versus rejections, stale status, and dormancy (negative) into a single
  0–1 score, a tier (`high|medium|low|dormant`), and a prune-candidate flag.
- **`mem_feedback` MCP tool** — agents record whether a surfaced memory was `applied` (it steered
  the work) or `rejected` (wrong/unhelpful). This closes the loop: a read only means a memory was
  shown; `applied` means it demonstrably helped. Backed by a new `applied_count` usage signal.
- **`haive memory impact` CLI** — ranks memories by demonstrated utility and surfaces prune
  candidates (`--prune`), with `--tier`, `--id`, and `--json` filters.

### Notes
- Surfacing impact as a ranking weight inside `get_briefing` is intentionally deferred to a later
  increment to avoid destabilizing the briefing pipeline. Legacy `usage.json` records are
  normalized for the new fields, so the change is backward compatible.

## [0.10.9] — finish gate and release discipline

### Added
- **Final agent-exit gate** — `haive enforce finish` verifies that completed work is committed, pushed, versioned in lockstep, tagged, and that release tags exist on the remote.
- **Release-protocol prompt wiring** — bridge templates, post-task guidance, and project docs now instruct agents to run the finish gate before final responses.

### Fixed
- CI enforcement now inspects the committed base/head diff instead of only staged files.
- Shippable package typechecks no longer depend on stale workspace `dist/` artifacts.
- Autopilot repairs, stack-pack diagnostics, and assignment-style memory sensors now handle the audited edge cases more precisely.

## [0.10.5] — sensor promotion and sharper patterns

### Added
- **Sensor promotion workflow** — `haive sensors promote <memory-id> --yes` flips a vetted memory
  sensor to `severity: block`; `--severity warn` can soften it again.

### Changed
- **Sharper autogenerated sensor patterns** — assignment-style gotchas such as `open-in-view=true`
  now generate regexes that include the offending value instead of matching only the broad key.

## [0.10.4] — memory sensors Phase 2

### Added
- **Memory sensors Phase 2** — sensors now parse unified diffs per file, use stricter path scoping,
  surface `severity: block` as deterministic pre-commit blockers, and can be operated with
  `haive sensors list/check/export`.
- **Assisted sensor generation** — anchored `gotcha`/`attempt` records saved through `mem_save`,
  `mem_tried`, `haive memory add`, or `haive memory tried` can receive conservative autogenerated
  `warn` regex sensors.

## [0.10.3] — memory sensors (feedback computational layer)

### Added
- **Executable sensors** — a memory (`gotcha`/`attempt`) can now carry an optional `sensor` block in
  its frontmatter (`packages/core/src/schema.ts` → `SensorSchema`). Phase 1 supports `kind: "regex"`:
  a deterministic check that fires on the **added** lines of a diff, turning a documented lesson into a
  permanent guardrail. This is the harness "feedback computational" layer — same result every run, no
  embedding warmup. `shell`/`test` kinds are reserved for a later phase.
- **`@hiveai/core` sensor engine** — new `packages/core/src/sensors.ts`: `runSensors`, `runRegexSensor`,
  `compileRegexSensor`, `sensorAppliesToPath`, `addedLinesFromDiff` (pure, no I/O).
- **`anti_patterns_check` sensor reason** — sensors are evaluated alongside anchor/literal/semantic
  matches and surface as a new `"sensor"` reason, carrying `sensor_message` and `sensor_severity`.
  Sensor hits rank above all other reasons (deterministic, highest signal). Retired memories
  (`isRetiredMemory`) are excluded as before.

## [0.10.2] — harness positioning

### Changed
- **Product positioning clarified** — public docs, npm metadata, and CLI help now describe hAIve as
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

A benchmark (10 cold agents, 5 projects, hidden-policy rubric) showed hAIve's real value: **correctness
on arbitrary, team-specific knowledge a model cannot infer (5/5 vs 3/5)** — not speed or token savings
(on inferable tasks it was pure overhead). This release re-shapes the product around that truth.

### Added
- **Specificity ("surprise") scoring** (`specificityScore`, `isLikelyGuessable` in `@hiveai/core`) — a
  cheap heuristic estimating how *unguessable* a memory is (concrete literals/identifiers/values vs generic prose).
- **Adaptive briefing.** `get_briefing` now returns `briefing_value: "high" | "low"`. When nothing
  team-specific matches the files/task, the auto-generated/unfilled project context is trimmed to a
  one-line note so the call stays near-zero-cost (config: `adaptiveBriefing`, default on). A capable
  model needs nothing extra there. Curated context is never trimmed. The `haive briefing` CLI mirrors this.
- **`memory lint` LOW_VALUE_GUESSABLE** — flags memories that read like generic best practice the model
  already follows, nudging curation toward unguessable team knowledge.
- **Aggressive corpus decay**: `haive memory archive --unread` deprecates memories by unread-age alone
  (ignoring anchor state); window defaults to `enforcement.decayAfterDays` (180). A stale corpus is
  actively harmful — it makes agents follow outdated policy.
- **Capture filter**: `mem_observe` now SKIPS low-specificity (guessable) observations by default to keep
  the corpus high-signal; pass `force: true` to override.

### Changed
- **Diff-aware gate.** Anti-pattern literal matching now considers only ADDED diff lines, so the gate
  fires on "you introduced the bad pattern", not "you touched/removed a file that mentions it" — fewer
  false positives on refactors.
- **Tighter CLI surface.** Default `haive --help` shows the 10-command core harness loop; `tui`,
  `welcome`, and the manual `precommit` variant move behind `--advanced` (everything still works).
- **Repositioned.** README/tagline now lead with the proven value — *stop agents from reinventing,
  wrongly, your team's non-obvious decisions* — and the benchmark section reports the honest 5/5-vs-3/5
  results with the real per-policy-type token costs. All speed/token-savings claims removed.

## [0.9.31] — gate consistency

### Fixed
- **`haive precommit` now honors `enforcement.antiPatternGate`.** Previously the standalone command always used its own `--anchored-blocks` default and ignored project config, so a team that softened the gate to `review` (or `off`) in `.ai/haive.config.json` still got hard blocks when running `haive precommit` by hand — diverging from the installed git hook. The gate→params mapping is now centralized in `@hiveai/core` (`antiPatternGateParams`) and consumed by both `haive enforce check` (the hook) and `haive precommit`, so the two surfaces can no longer drift. Explicit flags still override: `--block-on <mode>` and `--no-anchored-blocks`.

## [0.9.30] — enforcement honesty & quality pass

### Added
- **Honest, configurable anti-pattern gate.** New `enforcement.antiPatternGate` config (`off` · `review` · `anchored` (default) · `strict`). In `anchored` mode the pre-commit gate now **hard-blocks** a high-confidence `attempt`/`gotcha` that is anchored to a file you touch and corroborated by the diff — closing the gap where the documented "known bad approaches are blocked" only surfaced as a soft review. `pre_commit_check` gained an `anchored_blocks` parameter (and `haive precommit` a `--no-anchored-blocks` opt-out). Config/docs-only commits are still never hard-blocked.
- **Deterministic literal matching.** `anti-patterns-check` now tokenizes diffs on non-word boundaries (code-aware, with a keyword stoplist), so identifiers glued to punctuation (`Number(BigInt(a))`) reliably produce a `literal` signal instead of leaving blocking to depend on a warmup-sensitive semantic score.
- **`haive index code --status [--json]`** — report code-map / code-search index freshness without rebuilding.
- **`haive memory verify --json`** — machine-readable anchor-freshness output for CI/agents (exit 1 on stale).
- **`--files` alias for `--paths`** on `memory add` / `memory tried` / `memory update`, matching the MCP `files` parameter.

### Changed
- **Stack detection** no longer mislabels a TypeScript project as JavaScript when there is no root `tsconfig.json` — it scans for `.ts`/`.tsx` sources.
- **CI hardening:** type-check now runs *before* tests and is **blocking** (removed `continue-on-error`), catching the source/dist desync that previously surfaced only as confusing test failures.
- **Clearer `haive init` messaging:** user-level MCP client configs are reported as "user-level config — left unchanged" so it no longer looks like the project setup was skipped.
- **README aligned with reality:** enforcement section describes precise anchored blocking vs. surfaced review; the benchmark section now presents the honest internal pilot (`n=3`, proxy tokens, no raw-speed claim) instead of inflated headline deltas.

## [0.9.29] — developer curation

### Added
- **`haive memory seed [stack]`** — seed a stack pack of starter memories on demand (after `haive init`). Auto-detects stacks from `package.json` when no argument is given, supports `--list` / `--list --json` for discovery, and refreshes the embeddings index in autopilot. Seeded memories carry the `stack-pack` tag and stay at background priority until anchored.
- Enforcement hooks now give file-specific must-read reminders during `pre-tool-use` when a write targets files covered by validated anchored policies that were not in the current briefing.

### Changed
- `haive briefing`, `haive enforce session-start`, and wrapped `haive run` sessions now attempt lightweight autopilot repairs before generating context, so stale/missing semantic indexes are fixed before agents need them.
- `haive session end --auto` can synthesize a useful recap from the current git diff when no hook observation log is available.
- Enforcement findings now carry clearer educational details (`why`, files, and memory IDs) for missing decision coverage.

## [vscode-0.6.1] — brand icon

### Added
- **Brand icon & glyph** — honeycomb cluster with a single glowing amber cell (the "surfaced memory" signature). `media/icon.png` (256×256) is the Marketplace icon; the activity-bar container now uses the monochrome `media/logo-mono.svg` glyph (themable via `currentColor`) instead of the `$(book)` codicon. Adds `favicon.*`, `logo.svg`, `wordmark.svg`, and a README header logo. The preview page `media/index.html` is excluded from the packaged `.vsix`.

## [vscode-0.6.0] — developer curation actions

### Added
- **Seed starter memories from the editor** — `hAIve: Add Starter Memories (Stack Pack)…` (sidebar title + command palette) lists supported stacks (auto-detected ones first) and seeds the chosen pack via `haive memory seed`.
- **Anchor a memory/seed to a file** — `hAIve: Anchor Memory to File…` (context menu on any memory; inline action on seeds) anchors the record to the active file or one you pick, turning a generic background seed into high-signal, repo-specific context.
- **Promote a memory to the team** — `hAIve: Promote Memory to Team` runs `haive memory promote` from the tree.
- **"🌱 Seeds — needs curation" group** — unanchored `stack-pack` seeds are surfaced as a dedicated curation queue with a 🌱 badge and a tooltip explaining how to raise them above background priority. Seed items expose an inline anchor action.
- Mutating curation actions run via the configured `haive.cliPath`, stream output to the hAIve channel, and auto-refresh the tree/status bar.

## [0.9.28] — signal & coordination polish

### Changed
- **Stack-pack seeds no longer crowd out repo knowledge.** Memories pre-seeded at `haive init` are tagged `stack-pack` and capped at `background` priority in both the MCP `get_briefing` and the CLI `haive briefing` rankings, so a generic framework note never outranks a repo-specific memory unless it has been anchored to a file you are actually editing. Each seed now carries an honest footer, and the init message no longer calls them "validated team memories useful from J+0".
- **Bridge files are now a table of contents, not a manual.** `CLAUDE.md` / `.cursorrules` / `copilot-instructions.md` use a shorter, less imperative template (~25 lines), and `haive sync --inject-bridge` injects one summary line per memory (not full bodies) and skips `stack-pack` seeds — keeping the always-loaded bridge compact.
- **`pre_commit_check` weights warnings by file type.** A package/build/tooling gotcha (by tag or anchor) is downgraded to `info` when the change touches no package/build file, mirroring the existing config/docs-only downgrade. Cuts false positives on pure source edits.

### Added
- **MCP `get_briefing` (and `mem_relevant_to`) now write the enforcement briefing marker.** An MCP-native agent that calls `get_briefing` before editing satisfies the pre-tool-use / pre-commit gate directly, without shelling out to the CLI `haive briefing`. The marker records the surfaced anchored policy IDs so the per-file decision-coverage check passes for the files the briefing covered.

### Fixed
- Root `package.json` and `.ai/project-context.md` version aligned with the package builds (was `0.9.26` vs `0.9.27`), clearing the `repo-root-version-mismatch` doctor finding.
- Removed the obsolete `2026-04-28-decision-v028-features-overview` draft memory (shipped long ago, fully covered by this changelog) that had been flagged as a 30+ day stale draft and was polluting briefings for core files.

## [0.9.24] — autopilot indexing polish

### Fixed
- `haive index code` now includes untracked source files that are not ignored by git, so fresh or in-progress repos get useful code-map and code-search indexes before the first commit.
- `haive precommit --json` now emits valid JSON even when no files are staged.
- `haive memory add` in autopilot mode now refreshes the memory embeddings index immediately after creating or updating a record.
- `haive doctor --fix` now forces a code-map refresh when repairing autopilot indexes, while avoiding rewrites when the indexed file set is unchanged.

## [0.9.23] — cleanup and precommit signal polish

### Fixed
- `haive enforce cleanup` now preserves `.ai/.cache/.gitignore` while removing cache contents, so existing repos keep generated cache files ignored after cleanup.
- `pre_commit_check` now requires a very strong semantic score before blocking anti-pattern matches, reducing false positives from generic historical test notes while keeping plausible matches in review.

## [0.9.22] — autopilot convergence polish

### Fixed
- `haive doctor --fix` now refreshes memory embeddings as part of corpus repair, so semantic briefing diagnostics can converge without a separate manual `haive embeddings index`.
- Project-context version repair now works for generic bootstrapped contexts, not only the hAIve repo's own `# Project context — hAIve (v...)` heading.
- `haive init --bootstrap` writes current project version metadata and prepares `.ai/.cache` / `.ai/.runtime` ignore files from day zero.
- `haive enforce cleanup` preserves briefing markers while removing disposable runtime/cache files, so cleanup no longer makes local enforcement fail immediately afterward.
- `haive memory add` can derive a slug automatically and wraps plain bodies in a lint-friendly heading/guidance structure.
- `haive memory lint` no longer flags brand-new validated memories as `NEVER_READ` before agents have had time to surface them.
- `haive briefing --format compact` is accepted as a compatibility alias for users coming from the MCP `get_briefing` API.
- Root/workspace version skew and stale global hAIve packages are now visible in `haive doctor` for the hAIve workspace.

### Changed
- Harness coverage wording is stricter: sub-50% coverage is now described as partial instead of "good".
- pnpm overrides moved from the deprecated root `package.json` field into `pnpm-workspace.yaml`.

## [0.9.21] — quality audit fixes

### Fixed
- `haive memory pending` now shows both `draft` and `proposed` memories (was silently ignoring drafts). Output is grouped and labeled: "Proposed — awaiting team validation" / "Draft — created but not yet activated".
- `haive memory list` now displays the memory title (first `#` heading from body) between the ID and file path lines — consistent with `haive welcome`.
- `haive memory tried` help text had a duplicate `(default: personal)` from Commander double-printing — fixed.
- VS Code Harness Health view: `DoctorScores` interface field names now match the actual `haive doctor --json` output (`protection_score`, `context_quality_score`, `corpus_quality_score`). Previously all scores showed as `undefined`/NaN.
- VS Code Harness Health view: `DoctorFinding.severity` now matches JSON (was incorrectly `level`), fixing finding icons.
- Root `package.json` version bumped to `0.9.20` (was stale at `0.9.19`).
- `.ai/project-context.md` version header updated to `v0.9.20`.

### Added
- `haive memory update` now accepts `--type <type>` to change a memory's type without losing its usage history (previously required `rm` + `add`).
- `haive memory update` now accepts `--body-file <path>` to load body from a Markdown file — consistent with `haive memory add`.
- `haive tui` is now visible in the default CLI help (was hidden behind `--advanced`). It is the primary interactive memory browser for humans.
- `haive session` command description now explains that session start is automatic (via hooks/MCP), so users are not confused by the absence of `haive session start`.

## [vscode-0.5.0] — harness engineering extension redesign

### Added
- **Harness Health view** — second panel in the hAIve sidebar that runs `haive doctor --json` and displays protection, context quality, corpus quality, and harness coverage scores with color-coded pass/warn/error indicators. Findings grouped by section, expandable in the tree.
- **`skill` memory type** — `⚡ Skills` group appears first (after action-required alerts) in the sidebar tree, before all other types. Skill memories always expanded. CodeLens summary shows skills first with `⚡` icon.
- **Search memories command** (`Ctrl+Shift+H` / `Cmd+Shift+H`) — QuickPick fuzzy search across all memory titles, scopes, types, and tags. Opens the selected memory file beside the current editor.
- **Briefing command** (`Ctrl+Shift+B` / `Cmd+Shift+B`) — runs `haive briefing` for the active file and displays results in an "hAIve Briefing" Output Channel with Markdown syntax highlighting.
- **`haive.runDoctor` command** — runs a full health check from VS Code, populates the Harness Health view, and reveals it.
- **`haive.syncMemories` command** — runs `haive sync`, reloads the tree, shows progress in status bar.
- **`haive.memTried` command** — two-step input (what + why) that runs `haive memory tried` in a terminal. Available in the editor right-click menu.
- **Approve / Reject memory commands** — context menu on tree memory items; also accessible by ID.
- **Show All Memories command** — clears the file filter and shows the full tree.
- **Pending Review group** — draft and proposed memories grouped under "🕐 Pending Review" (collapsed by default) so nothing gets lost in the queue.
- **Briefing panel** available from editor title bar and editor right-click menu (`haive.runBriefing`).
- **`haive.cliPath` setting** — absolute path to the haive binary for environments where haive is not on PATH.
- **`haive.briefingBudget` setting** — `default | deep | minimal` controls the token budget passed to `haive briefing`.

### Changed
- Status bar now shows pending count alongside action-required count.
- Memory tooltips now include read count, module, and domain fields.
- CodeLens per-memory list sorted by type priority (skills first, gotchas second).
- Stale memories shown with a dimmed icon in the tree.
- Unknown memory types no longer pollute the main list — collected into an "Other" group.

## [0.9.20] — harness engineering positioning + skill type + harness coverage

### Added
- New memory type `skill` — reusable procedure/playbook for recurring tasks (e.g. deploy checklist, code-review protocol). Equivalent to OpenAI's SKILL.md pattern. Skills are always surfaced as at least `useful` in briefings, `must_read` when they match semantically. No anchor required.
- `haive doctor` now reports a `harness_coverage_score` — the percentage of code-map files that have at least one validated memory anchor. Visible in both `--json` output and the human-readable "Harness coverage" section.
- `haive welcome` now lists `skill` memories first (before decisions, architecture, conventions) as they are the primary feedforward guides for new team members.

### Changed
- CLI description updated to "the memory and enforcement layer of your agent harness" to align with the harness engineering vocabulary (see [OpenAI harness engineering](https://openai.com/index/harness-engineering/)).
- All package descriptions and keywords updated with "harness-engineering".
- `skill`, `glossary`, and `session_recap` types are now excluded from the anchorless-majority warning in `haive doctor` and the per-memory anchor warning in `haive memory add` — these types are procedural/reference records that don't track code drift.

## [0.9.19] — bundled semantic autopilot

### Added
- `@hiveai/cli` and `@hiveai/mcp` now install `@hiveai/embeddings` as a real dependency, so a normal global hAIve install includes semantic memory ranking and code-search support.
- `haive doctor` now checks embeddings availability, memory semantic index health, and code-search index health instead of reporting a healthy context score while semantic features are unavailable.
- The default MCP enforcement profile now exposes `code_search`, matching the code-search index that autopilot maintains.

### Changed
- `haive memory suggest --auto-save` now follows project defaults: autopilot projects save validated team records, while manual projects keep draft review flow.
- Generated memory-suggest templates now reference the real memory id in follow-up commands instead of a truncated query string.

## [0.9.18] — self-maintaining autopilot

### Added
- Added `autoRepair` config so autopilot can safely maintain project context metadata, corpus lint fixes, code-map refreshes, and code-search indexes without manual intervention.
- Added shared autopilot repair utilities used by `haive doctor --fix` and `haive sync`.
- `haive init` now writes autopilot projects with validated team memories, self-repair enabled, code-map creation, MCP setup, hooks, and CI from day zero.

### Changed
- `haive memory add` now follows project config defaults: autopilot projects create validated team records unless a scope is explicitly provided.
- `haive sync` now applies safe corpus/context repairs in autopilot mode and rebuilds both memory and code embedding indexes when code-search auto-repair is enabled.
- `haive doctor` reports project-context version drift without mutating files unless `--fix` is used.

### Fixed
- Autopilot init no longer suggests bootstrapping project context when the default autopilot bootstrap already ran.
- Memory lint anchor suggestions now ignore generated, ignored, and untracked paths to avoid polluting context records with noisy anchors.

## [0.9.17] — core signal quality and surgical enforcement

### Added
- `get_briefing` and `mem_relevant_to` now classify returned memories as `must_read`, `useful`, or `background`, and include a `briefing_quality` summary (`strong`, `thin`, or `noisy`).
- `haive memory lint --fix --dry-run|--apply` now reports simple corpus repairs and can add missing headings plus `needs_anchor` tags for validated anchorless policy records.
- `haive enforce check/status/ci --explain` now groups findings into blocking, review, and info sections.
- `haive doctor --json` now exposes protection, context quality, and corpus quality scores with sectioned findings and next actions.

### Changed
- Briefing ranking now prioritizes direct path/symbol anchors and directly relevant failed attempts ahead of popular but less relevant memories.
- `haive briefing` defaults to a tighter memory cap and prints memory priorities plus a briefing quality line.
- Precommit enforcement downgrades weak docs/changelog, config-only, and `.ai/.usage` telemetry matches to reduce false positives.

### Fixed
- `mem_save` topic upsert no longer writes `body` into frontmatter.
- `mem_save` now emits a strong warning when validated `decision`, `gotcha`, or `architecture` memories are saved without anchors.

## [0.9.16] — focused core surface and MCP profiles

### Added
- Added explicit MCP tool profiles: `enforcement` for the compact agent harness, `maintenance` for corpus/team stewardship, and `experimental` for broad research diagnostics; `full` remains a legacy alias for `experimental`.
- Added exported MCP profile constants and `getAllowedToolsForProfile()` so tests and integrators share the same source of truth.

### Changed
- The default CLI help now shows the core hAIve workflow first: init, doctor, agent setup, briefing, enforcement, sync, session recaps, and high-signal memory commands.
- Maintenance and experimental CLI commands remain callable but are hidden from default help; use `haive --advanced --help`, `haive --advanced memory --help`, or `HAIVE_SHOW_ADVANCED=1` to show the broader surface.
- The `maintenance` MCP profile exposes lifecycle, review, lint/distill, import-adjacent, and code-search tools without enabling runtime journal, pattern detection, or exploratory why/conflict diagnostics.

## [0.9.15] — harness diagnostics and quieter enforcement

### Added
- Added install/version diagnostics to `haive doctor` and `haive enforce status` for stale absolute hAIve binaries in hooks and MCP configs.
- Added `why` explanations to `get_briefing` memory results so agents can see why each context record was surfaced.
- Added glob-style anchor matching (`*`, `**`, `?`) and directory-symbol verification for broader module/pattern policies.

### Changed
- `pre_commit_check` now classifies anti-pattern matches as `blocking`, `review`, or `info`, with rationale text; the CLI hides weak FYI matches by default.
- The default MCP enforcement profile now includes `mem_tried`, `mem_get`, and `code_map` as focused core workflow tools.
- `haive memory lint` now flags low-actionability records, never-read validated records, and near-duplicate records.

## [0.9.14] — repo-native context enforcement positioning

### Changed
- Repositioned npm- and GitHub-facing docs around repo-native context enforcement instead of persistent memory.
- Updated README terminology to describe hAIve records as enforceable context breadcrumbs for AI agents.
- Refreshed package metadata and VS Code extension wording around policy, breadcrumbs, and context enforcement.

## [0.9.13] — enforcement false-positive fixes

### Fixed
- Session recap updates now refresh `verified_at`, so strict gates count an updated recap as recent without rewriting its original creation date.
- `haive enforce` now checks recap freshness using `verified_at ?? created_at`.
- `pre_commit_check` no longer blocks `high-confidence` mode on literal-only or anchor-only anti-pattern matches; blocking now requires a strong semantic signal.

### Changed
- `haive precommit` now reports blocking anti-pattern warnings separately from advisory anti-pattern matches.

## [0.9.12] — agent-aware init and setup

### Added
- Added `haive agent detect/status/setup` to choose between native MCP, wrapped, and CLI fallback modes per machine.
- `haive init` now runs agent-aware setup, writes project MCP configs, records `.ai/.runtime/enforcement/agent-mode.json`, and asks before changing user-level AI client configs.
- Added Codex CLI MCP setup support via `codex mcp add haive ...` when Codex is detected and the user approves global setup.

## [0.9.11] — enforcement scoring and agent benchmark reports

### Added
- Added enforcement scoring to `haive enforce check/status/ci`, including configurable score thresholds.
- Added decision coverage checks: changed files now require relevant anchored decisions/gotchas/conventions to be surfaced in the latest briefing.
- Added `haive enforce cleanup` for generated `.ai/.cache` and `.ai/.runtime` artifacts.
- Added `haive benchmark demo` and `haive benchmark report` to make hAIve-vs-plain agent trials a repeatable product demo.

### Changed
- Tightened the default MCP enforcement profile to the core workflow tools: briefing, memory save/search/verify/relevance, pre-commit check, and session recap.
- Briefing markers now record surfaced memory IDs and target files, allowing enforcement to verify that the right decisions were consulted.

## [0.9.10] — npm positioning and enforcement narrative

### Changed
- Reframed npm-facing documentation and package metadata around hAIve as an AI-agent policy enforcement layer, with persistent memory described as the mechanism rather than the headline.

## [0.9.9] — agent-agnostic enforcement and `haive run`

### Added
- Added agent-agnostic enforcement commands: `haive enforce install`, `haive enforce status`, `haive enforce check`, and `haive enforce ci`.
- Added `haive run -- <agent command>` to wrap any CLI-based coding agent in a hAIve-enforced session with `HAIVE_PROJECT_ROOT`, `HAIVE_SESSION_ID`, and strict enforcement env vars.
- Added a blocking GitHub Actions enforcement workflow template generated by `haive enforce install`.
- Added strict enforcement config fields for briefing, session recap, memory verification, stale-decision blocking, and mode selection.

### Changed
- `haive briefing` now writes a local briefing marker, so CLI-first agents can satisfy the same enforcement gate as hook-based agents.
- Autopilot `haive init` now installs agent-agnostic enforcement gates instead of only Claude Code hooks.
- Git hooks installed by hAIve are now blocking workflow gates by default, not advisory reminders.

## [0.9.8] — enforcement hooks and default MCP profile

### Added
- Added hAIve enforcement mode as the default MCP profile for initialized projects: the default MCP surface is now the smaller enforcement set, with `HAIVE_TOOL_PROFILE=full` available for the legacy full tool list.
- Added `haive enforce session-start` and `haive enforce pre-tool-use` for agent hooks. Claude Code hooks can now inject a briefing marker at session start and block write-like tools until briefing is loaded.
- Added `.ai/.runtime/enforcement/briefings/` marker support for local pre-edit enforcement.

### Changed
- `haive install-hooks claude` now installs `SessionStart`, `PreToolUse`, `PostToolUse`, and `SessionEnd` hooks instead of passive capture only.
- Autopilot `haive init` installs project-scoped Claude Code enforcement hooks when possible.

## [0.9.7] — enforcement direction and release hygiene

### Fixed
- Aligned the root package version and project context version with the publishable package line.
- Added consistent `shared` scope path support for memory file resolution.
- Restored full `pnpm -r typecheck` health across core, CLI, MCP, embeddings, VS Code, and GitHub Action packages.
- Updated CLI/MCP call sites for current `code_map` and embeddings APIs.

### Added
- Added an enforcement strategy plan for narrowing hAIve around briefing gates, PR guardrails, and a smaller default MCP tool surface.

## [0.2.0] — token-aware briefing, code map, sync hooks

### Added — token reduction
- **`get_briefing` MCP tool**: one-shot onboarding that bundles project
  context + module contexts + ranked relevant memories under a token budget.
  Replaces 4–5 separate calls (`get_project_context`, `mem_for_files`,
  `mem_search` literal, `mem_search` semantic) and dedupes results
  ranked by reason (anchor / module / semantic / domain) and confidence.
- **Code map** (`haive index code` → `.ai/code-map.json`): static parse of
  TS/JS exports per file with JSDoc-derived 1-line descriptions. AIs read
  the map (~30KB on this repo) instead of greping 30+ files. Exposed as
  the `code_map` MCP tool with file/symbol filters.
- **Token budget helpers** in `@hiveai/core`: `estimateTokens`,
  `truncateToTokens` (head/tail/middle), `allocateBudget` distributes a
  global budget across weighted parts and re-allocates surplus from
  small parts to larger ones.

### Added — sync on merge / near-realtime
- **`haive sync`**: refreshes anchor verification + auto-promotion in
  one command. `--since <ref>` reports memories added/modified/removed
  vs a git ref. `--quiet` for hooks.
- **`haive install-hooks`**: writes `.git/hooks/post-merge` and
  `post-rewrite` that run `haive sync --quiet --since ORIG_HEAD` so
  every pull/merge updates memory state automatically.
- **GitHub Action template** at `.github/workflows/haive-sync.yml.example`:
  on push to main/develop, runs sync and commits any state updates;
  on PR, comments if memories anchored in the diff would become stale.

### Added — quality of life
- **`haive memory hot [--threshold N]`**: surfaces drafts/proposed
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

- **Breaking install behavior** : `@hiveai/embeddings` was an
  `optionalDependency` of `@hiveai/cli` and `@hiveai/mcp`, which means
  npm pulled it (and its full Transformers.js / onnxruntime / sharp
  dependency tree) on every install — bringing in 35 known
  vulnerabilities including a critical one (`protobufjs <7.5.5`,
  GHSA-xq3m-2v4x-88gg, via `onnx-proto`).
- It is now a `peerDependency` with `optional: true`. End users who
  do not need semantic search no longer pull the ML chain, going from
  ~150 transitive packages to ~20.
- Users who do want semantic search install it explicitly:
  `npm install @hiveai/embeddings`. The CLI/MCP code already lazy-imports
  it, so behavior is unchanged when present.
- Added a `protobufjs >=7.5.5` override at the workspace and embeddings
  package level to patch the critical vuln even when the ML chain is
  installed. `pnpm audit --prod` reports zero known vulnerabilities.

### Added — v0.4 (foundation cycle: real-world testing, staleness, validation, relevance, CRUD, review)

- **A. Real-world MCP integration.** Project-scoped `.mcp.json` so Claude
  Code auto-detects the local server. Multi-word literal `mem_search` (token
  AND across id/tags/body, case-insensitive) extracted to `@hiveai/core` and
  shared by CLI and MCP.
- **B. Staleness detection.** `verifyAnchor` checks that `anchor.paths`
  exist and `anchor.symbols` are still present in those files; `haive
  memory verify [--id X | --all] [--update]` and the `mem_verify` MCP tool
  optionally write back `status=stale` with `verified_at` and
  `stale_reason` to the frontmatter.
- **C. Passive validation + confidence levels.** Per-memory usage tracked
  in a sidecar (`.ai/.cache/usage.json`, gitignored). `mem_search` increments
  `read_count` and returns a derived `confidence` (`unverified | low | trusted
  | authoritative | stale`). New `mem_reject` tool / `haive memory reject`
  command records explicit rejections. `haive memory auto-promote
  [--min-reads N] [--max-rejections N] [--apply]` lifts proposed memories
  to validated based on real use.
- **D. Module-aware auto-loading.** `mem_for_files <files...>` infers
  modules from conventional layouts (`packages/`, `apps/`, `modules/`,
  `src/`) and returns relevant memories grouped by reason (anchor overlap,
  module match, domain match) plus inlined module-context files.
- **F. CRUD completeness.** `haive memory show / edit / rm` and the
  `mem_get` / `mem_delete` MCP tools.
- **E. Light memory PR workflow.** `haive memory pending` lists
  proposed memories awaiting review, sorted by reads desc; `haive memory
  approve <id>` and the `mem_approve` MCP tool perform an explicit review.

### Changed
- `mem_search` and `mem_list` now expose `confidence` and `read_count` on
  every hit; `mem_search` accepts a `track: false` opt-out.
- `@hiveai/embeddings` is now an `optionalDependency` of `@hiveai/mcp` so
  semantic mode works out of the box when the package is installed.

### Tests
- 105 passing (64 core / 17 embeddings / 16 mcp / 8 cli).

## [v0.3] — local embeddings + semantic search

- New `@hiveai/embeddings` package built on Transformers.js
  (`Xenova/bge-small-en-v1.5`, 384 dims), runs entirely locally.
- CLI: `haive embeddings index | query | status`. MCP: `mem_search` gains
  `semantic` + `min_score`, with graceful literal fallback when the index
  or package is missing.
- Cache at `.ai/.cache/embeddings/embeddings-index.json` with per-entry
  SHA-256 invalidation.

## [v0.2] — MCP server

- `@hiveai/mcp` (stdio) exposes 5 tools (`mem_save`, `mem_search`,
  `mem_list`, `get_project_context`, `bootstrap_project_save`) plus the
  `bootstrap_project` prompt. Bin `haive-mcp` and CLI command `haive mcp`.

## [v0.1] — foundations

- Monorepo (pnpm workspaces, Node 20 LTS, `tsup`, `vitest`).
- `@hiveai/core` memory schema (zod) + frontmatter parser/serializer + path
  resolution + recursive loader.
- `@hiveai/cli` first commands: `haive init`, `haive memory add | list |
  query | promote`. Approach B (Personal first): new memories default to
  `personal`; explicit `promote` is the only way into `team`.
