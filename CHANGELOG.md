# Changelog

All notable changes to hAIve are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and the
project follows semantic versioning once it ships its first stable release.

## [Unreleased]

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
