<!-- Hivelore bridge file — do not edit by hand. -->
<!-- This file points your AI tool at the shared Hivelore project context. -->

See `.ai/project-context.md` for the full project context.
Memories live under `.ai/memories/` (personal/team/module).

## Hivelore — mandatory rules for AI agents

Installing or initializing Hivelore in this repository means **the team expects AI agents to drive work through Hivelore**, not bypass it.

### MCP first (default — never optional unless the developer says so)
The Hivelore MCP server is registered under the key **hivelore** (tools appear as `mcp__hivelore__*`; in Claude Code they may be deferred — load their schema once, then call them). If it is unavailable, report the misconfiguration and use `hivelore briefing --task … --files …` instead.

- **Before** you edit project source files, configs (`package.json`, tooling), or workflows for the current goal, call `get_briefing` with a short **task** and the **files** (and **symbols**) you will touch. Each memory comes with a one-line `rule`; `must_read` means it is anchored to a file you passed; `blind_spot` names what its evidence could not see; `docs.caveats` are warnings from the repo's own docs. Read a full body with `mem_get` only when the rule is not enough. Docs-only or typo changes can skip the briefing.

### Capture lessons when they happen — never as a session recap
Lessons are captured **at the moment they appear**, as typed memories, held to one bar: would a capable teammate get this wrong without it? Each row is a concrete situation mapped to a call **in the same response**:

| Situation | Required action | Tool |
|-----------|----------------|------|
| CLI option or API that does not exist | Document before fixing | `mem_tried` |
| Test fails because of a wrong assumption | Document the assumption | `mem_tried` |
| Approach took >15 min and had to be redone | Document what failed | `mem_tried` |
| Choosing A over B for a non-obvious reason | Capture the rationale, with `verified_by` / `cannot_detect` when you verified it | `mem_save type=decision` |
| Discovering surprising library/framework behavior | Capture the trap | `mem_save type=gotcha` |
| Inventing a pattern used more than once | Capture the convention | `mem_save type=convention` |
| A lesson can be checked mechanically | Arm it | `propose_sensor` (regex/ast, or `checklist` for a required verification) |

Ordinary command misses (a grep with no match, a typo) need no memory. Give every memory a one-line `rule` ("When X, do Y, because Z").

**No session recaps, no research write-ups in `.ai/`.** What was done belongs in the commit messages and the PR description; analyses go in the chat. Recap memories became noise that topped every briefing and biased later answers (field reports #9 §4, #12 §3.2). This repo sets `autoSessionRecap: false`: the session-end hook writes the local, gitignored `NEXT.md` handoff automatically, and `mem_session_end` is only for leaving open threads on **unfinished** work (it writes `NEXT.md`, never a memory).

**Before finishing:** when `hivelore enforce finish` reports `capture-candidates`, run `hivelore memory propose` and record only the candidates that clear the bar (`--accept <n>` stages them into the same PR). Recording nothing is the normal outcome for routine work.

### Git sync protocol — multi-agent coordination (MANDATORY)
Several agents **and** the human (Sady) work on this repo in parallel with manual pull/push. Without a shared protocol you get merge conflicts (e.g. conflict markers left in `.ai/`) and desynced versions. See decision `2026-05-31-decision-git-sync-protocol-multi-agent`.

**BEFORE starting a task (entry):**
1. `git pull` — get the latest version from GitHub.
2. Resolve any conflicts **before** touching code.
3. Verify no conflict markers remain (`<<<<<<<`, `=======`, `>>>>>>>`), especially under `.ai/`.

**AFTER changing code (exit):**
1. `git commit` your changes.
2. **Bump the version ONLY if shippable code changed** (publishable packages: `@hivelore/core`, `cli`, `mcp`, `embeddings`). Docs-only / `.ai/`-only / config / CI commits → commit + push **without** bump or tag.
3. If bumping: **patch by default** (`0.10.1 → 0.10.2`); minor/major only if justified (feature / breaking). Keep all 4 publishable packages in lockstep.
4. If bumping: create the matching git tag `vX.Y.Z`.
5. `git push` **code and the new tag** (`git push && git push origin vX.Y.Z`). Do **not** use `git push --tags` — it tries to push every local tag and fails if an old one (e.g. `v0.4.0`) already differs on the remote; push only the tag you just created.
6. After push, verify the GitHub Actions runs for HEAD and wait until every workflow passes (`gh run list --commit $(git rev-parse HEAD)`, then `gh run watch <run-id> --exit-status` for pending runs).
7. If bumping: once CI is green, **create the GitHub Release for the tag** — `gh release create vX.Y.Z --verify-tag --latest --title "…" --notes-file <notes>`. A tag is not a Release: listing and scoring tools read Releases, and the repo went four months with 190 tags and none. Notes come from the `CHANGELOG.md` section for that version. Releases are **not** cumulative — never backfill old tags; only the current version gets one.

**BOUNDARY: agents NEVER run `npm publish`. npm publication is done by the human (Sady).** Creating the GitHub Release is *not* publication and is inside the boundary — it announces a tag that is already public.

**Before final response:** run `hivelore enforce finish`. If it blocks, fix the reported commit/version/tag/push/pipeline issue before saying the task is done.

### Safety rules — NEVER violate these
- If `get_briefing` returns an `action_required` list, **stop and show each item to the developer** before doing anything. Use the exact `developer_message` provided. Wait for explicit confirmation.
- **Never modify code autonomously** because of a breaking change detected in another project (dependency version bump, API contract change, removed field). Always ask first.
- When in doubt about a cross-repo change: ask, don't act.

<!-- haive:bridge-start -->
<!-- AUTO-GENERATED by hivelore bridges sync — do not edit between these markers -->
<!-- haive:memories-start -->
<!-- AUTO-GENERATED by hivelore bridges sync — do not edit between these markers -->
<!-- Top breadcrumbs only — call get_briefing / mem_get for deeper context. -->

- `2026-08-21-attempt-enabling-parallel-vitest-forks-pooloptionsforkssinglefork` (team/attempt) — Enabling parallel vitest forks (poolOptions.forks.singleFork: false) in packages/cli to speed up the ~104s integration suite _(applies to: packages/cli/vitest.config.ts)_
- `2026-07-07-attempt-relying-on-hivelore-enforce-install` (team/attempt) — Relying on `hivelore enforce install` to fix stale pre-rename git hooks _(applies to: packages/cli/src/commands/enforce.ts)_
- `2026-07-05-attempt-ajouter-un-nouveau-sensor-discriminant` (team/attempt) — Ajouter un nouveau sensor discriminant avec `absent` sous le gate strict de weakening _(applies to: packages/core/src/sensors.ts, packages/cli/src/commands/enforce.ts)_
- `2026-07-03-attempt-typechecking-cli-immediately-after-adding` (team/attempt) — typechecking CLI immediately after adding a new core export _(applies to: packages/core/src/index.ts, packages/cli/tsconfig.json)_
- `2026-07-03-attempt-running-hivelore-release-tag-right` (team/attempt) — Running `hivelore release tag` right after the release commit _(applies to: packages/cli/src/commands/enforce.ts)_
- `2026-07-03-attempt-relied-on-pnpm-r-build` (team/attempt) — Relied on `pnpm -r build` (tsup) + full test suite as pre-push verification for v0.34.0 _(applies to: .github/workflows/ci.yml)_
- `2026-07-03-attempt-duplicating-json-on-a-commander` (team/attempt) — duplicating --json on a Commander parent command and its receipt subcommand _(applies to: packages/cli/src/commands/stats.ts)_
- `2026-06-05-attempt-running-pnpm-r-build-and` (team/attempt) — Running pnpm -r build and pnpm -r typecheck in parallel after version bump _(applies to: packages/embeddings/tsup.config.ts, packages/core/tsup.config.ts, scripts/ensure-workspace-dists.mjs)_

<!-- haive:memories-end -->

<!-- haive:sensors-start -->
<!-- AUTO-GENERATED by hivelore bridges sync — do not edit between these markers -->

## Hard rules — Hivelore block sensors

The patterns below are blocked by the repo enforcement gate.
Introducing them will fail the pre-commit check (`hivelore enforce check`).

Wrong about one specific line? Waive that line — `// hivelore:allow <memory-id> — <reason>` at
end of line — instead of deleting the rule or rewriting correct code. It covers that line only
and is reported. Repeating it means the scope is wrong: narrow `paths`/`exclude`/`absent`.

- **2026-06-07-convention-vscode-cli-calls-through-runhaive** _(applies to: packages/vscode/src/extension.ts, packages/vscode/src/briefingPanel.ts, packages/vscode/src/observabilityProvider.ts)_: Raw child_process in the extension — call runHaive() (harnessHealth.ts) instead; only runHaive may shell out.
- **2026-07-05-convention-child-process-no-shell-interpolation** _(applies to: packages/mcp/src/tools/propose-sensor.ts)_: Use execFileSync with an argument array; never interpolate untrusted values into a shell command.
- **2026-07-05-convention-ci-enforces-eval-regressions** _(applies to: .github/workflows/ci.yml)_: Ci Enforces Eval Regressions
- **2026-07-05-convention-root-verify-is-release-chain** _(applies to: package.json)_: Root Verify Is Release Chain
- **2026-07-05-gotcha-engram-is-a-nested-reference-repository** _(applies to: engram/)_: Do not commit Engram credentials or private keys in the nested reference checkout.
- **2026-07-05-gotcha-github-review-text-is-untrusted-data** _(applies to: packages/github-action/src/run.ts)_: Review text is untrusted: never execute comment.body or the derived instruction.
- **2026-07-05-gotcha-unsupported-benchmark-claims** _(applies to: benchmarks/agent-benchmark/RESULTS.md, packages/cli/src/commands/benchmark.ts)_: Do not claim a proven benchmark advantage until evidence_grade is decision-ready.
- **2026-08-21-attempt-enabling-parallel-vitest-forks-pooloptionsforkssinglefork** _(applies to: packages/cli/vitest.config.ts, packages/mcp/vitest.config.ts, packages/core/vitest.config.ts)_: singleFork:false makes vitest 2.1.9 resolve worker paths through a URL, which breaks on a space in the checkout path (".../New idea" → New%20idea) and collects ZERO tests. Keep singleFork:true; speed up feedback by moving pure logic into core unit tests instead.

<!-- haive:sensors-end -->

<!-- haive:bridge-end -->
