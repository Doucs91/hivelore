# Contributing to hAIve

Thanks for helping. This guide is written so that **anyone — not just the original author — can build,
test, extend, and release hAIve.** Reducing the bus-factor is an explicit goal: if you can follow this
file end to end without asking a human, it is doing its job. Open an issue if a step is unclear.

## Prerequisites

- Node 20 LTS+ and `pnpm` 9+ (the repo pins `pnpm@9.14.2` via `packageManager`).
- This is a pnpm **workspace monorepo** — always run package scripts through pnpm, never `npm`.

```bash
git clone https://github.com/Doucs91/hAIve.git
cd hAIve
pnpm install
pnpm -r build      # build every package (topological order via workspace deps)
pnpm -r test       # run all suites (vitest)
pnpm -r typecheck  # tsc --noEmit across packages
```

## Repository map

| Path | What lives here |
|---|---|
| `packages/core` | **Pure domain layer.** Schemas, scoring/ranking, parsers, path resolution, sensors, eval math, code-map. No I/O beyond the memory loader, no CLI/MCP imports. Put deterministic logic here first. |
| `packages/cli` | `commander` CLI. One file per subcommand in `src/commands/`, registered on the root program. Keep command files **thin**: parse options → resolve root → call core/MCP → print. |
| `packages/mcp` | MCP server (stdio). Tool handlers in `src/tools/` are pure `(input, ctx)` async functions; `server.ts` is the registry. |
| `packages/embeddings` | Optional local semantic search (Transformers.js, `bge-small-en-v1.5`). `EmbedderLike` is injectable for tests. |
| `packages/vscode` | VS Code extension (surfaces memories + cockpit over the CLI). |
| `packages/github-action` | PR-comment action that posts relevant team memories. |
| `.ai/` | hAIve's **own** knowledge base (it dogfoods itself). Decisions, gotchas, conventions, and failed attempts live here as Markdown — read them; they explain *why* the code is shaped the way it is. |

## The golden rule of layering

Heavy logic (ranking, matching, scoring, parsing) goes in `@hiveai/core` where it is unit-testable
without stdio or a git repo. CLI and MCP only **orchestrate** it. See the team memory
`2026-06-02-architecture-core-pure-domain-layer` and `2026-06-02-architecture-cli-command-surface`.

## How to add things

### A new CLI command
1. Create `packages/cli/src/commands/<name>.ts` exporting a `register<Name>(program)` function.
2. Register it in `packages/cli/src/index.ts`.
3. If it is part of the day-to-day loop, add it to `CORE_ROOT_COMMANDS` (and update `STABILITY.md`).
   Otherwise it stays behind `--advanced` automatically.

### A new MCP tool
1. Add `packages/mcp/src/tools/<name>.ts` as a pure `(input, ctx)` handler.
2. Wire it in `packages/mcp/src/server.ts` (three lines: import, schema, registration).
3. Add it to the right profile constant (`ENFORCEMENT_PROFILE_TOOLS` / `MAINTENANCE_…` / `EXPERIMENTAL_…`).
   Tools in `enforcement` are the **stable** surface — hold that bar.

### A new executable sensor type or matcher
Sensors live in `packages/core/src/sensors.ts` (pure) and are surfaced via `haive sensors` and the
`enforce check` gate. Diff scanning must use `scannableSensorTargets` / `isSensorScannablePath` so it
never self-fires on `.ai/` or generated bridge files.

## Testing & quality bar

- Every behavioural change ships with a vitest test, preferably at the `core` layer.
- `pnpm -r test`, `pnpm -r typecheck`, and `pnpm -r build` must all be green before you push.
- `node scripts/verify-build-artifacts.mjs` checks the published bundles.
- `haive eval` runs the retrieval + sensor quality gate; CI fails on a regression.

## Release protocol (maintainers)

See `CLAUDE.md` for the full multi-agent git-sync protocol. In short:

1. Commit your work on a branch; open a PR.
2. **Bump the version only if shippable code changed** (`@hiveai/core`/`cli`/`mcp`/`embeddings`);
   docs/`.ai/`/CI-only changes ship without a bump. Patch by default; minor for features.
3. Keep all four packages in lockstep; create the matching `vX.Y.Z` tag.
4. Push code **and that tag**: `git push && git push origin vX.Y.Z` (never `git push --tags`).
5. Wait for every GitHub Actions run on HEAD to pass.
6. `npm publish` is done **only by a human maintainer** — agents never publish.

## Knowledge protocol (why `.ai/` matters)

hAIve uses hAIve. When you discover a non-obvious trap, make a real decision, or hit a dead end, capture
it (`haive memory save` / `haive memory tried`). This is how the project stays understandable without a
single person holding all the context in their head — the whole point of the product.
