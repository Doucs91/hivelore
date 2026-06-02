# Changelog

All notable changes to hAIve are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and the
project follows semantic versioning once it ships its first stable release.

## [Unreleased]

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
