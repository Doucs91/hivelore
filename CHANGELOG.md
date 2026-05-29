# Changelog

All notable changes to hAIve are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and the
project follows semantic versioning once it ships its first stable release.

## [Unreleased]

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
