# API stability & the 1.0 stable core

Hivelore is still `0.x`. This document declares the **surface we intend to freeze for 1.0** — the
commands, MCP tools, and on-disk formats a user or agent can depend on — versus the surface that
stays **experimental** and may change in any release.

> **Why this exists.** A coding-agent harness is only trustworthy if its contract is predictable.
> Freezing a small, well-tested core (and being honest that the rest is in motion) is what lets the
> project ship a real `1.0` without pretending all 66 CLI commands and 40 MCP tools are stable.

The lists below are not maintained by hand — they mirror the single source of truth in code:

- CLI core surface → `CORE_ROOT_COMMANDS` / `CORE_MEMORY_COMMANDS` / `CORE_SESSION_COMMANDS` in
  `packages/cli/src/index.ts` (everything else is hidden behind `--advanced`).
- MCP core surface → `ENFORCEMENT_PROFILE_TOOLS` in `packages/mcp/src/server.ts` (the default profile).

If those constants and this file ever disagree, the code wins — please open a PR to re-sync this file.

---

## Tier 1 — Stable core (the 1.0 contract)

These are covered by SemVer once 1.0 ships: a breaking change requires a major version bump.

### CLI — the golden path (`hivelore --help`)

| Command | Stable subcommands |
|---|---|
| `hivelore init` | — |
| `hivelore doctor` | — |
| `hivelore agent` | `setup`, `status` |
| `hivelore briefing` | — |
| `hivelore bridges` | `list`, `sync` |
| `hivelore enforce` | `install`, `status`, `check`, `ci`, `finish`, `commit-msg` |
| `hivelore run` | — |
| `hivelore sensors` | `list`, `check`, `export`, `promote` |
| `hivelore sync` | — |
| `hivelore mcp` | — |
| `hivelore memory` | `save`, `list`, `search`, `get`, `verify`, `lint`, `tried`, `delete` |
| `hivelore session` | `end` |

Old memory verbs (`add`/`query`/`show`/`rm`) remain as **permanent aliases** of
`save`/`search`/`get`/`delete` — scripts that use them keep working.

### MCP — the default `enforcement` profile

`get_briefing` · `mem_save` · `mem_tried` · `mem_search` · `mem_get` · `mem_verify` ·
`mem_relevant_to` · `code_map` · `code_search` · `pre_commit_check` · `mem_session_end` ·
`propose_sensor`

### On-disk formats (stable)

- The `.ai/` layout (`project-context.md`, `modules/<name>/context.md`, `memories/{personal,team,module}/`).
- The memory frontmatter schema in `packages/core/src/schema.ts` (additive changes only within a major).
- Memory ids: `YYYY-MM-DD-{type}-{slug}`.

---

## Tier 2 — Experimental (no stability guarantee)

Everything reachable only via `hivelore --advanced` or the `maintenance` / `experimental` MCP profiles.
These exist, are useful, and are tested — but their names, flags, output shape, and existence may
change in any release, including a patch. Examples: `tui`, `dashboard`, `stats`, `playback`, `eval`,
`benchmark`, `observe`, `snapshot`, `runtime`, `ingest`, `hub`, the review/import/digest/timeline/
conflict `memory` subcommands, and MCP tools such as `why_this_file`, `pattern_detect`,
`runtime_journal_*`, `mem_observe`.

Promote an experimental command/tool to Tier 1 by adding it to the relevant constant in code **and**
this file, with a test that exercises it.

---

## Versioning policy

| Phase | Rule |
|---|---|
| **Now (`0.x`)** | Patch by default; minor for features. The core surface is stable in practice but not yet contractually frozen. |
| **`1.0` onward** | Tier 1 follows SemVer: breaking change → major. Tier 2 may change in any minor/patch. |

All four publishable packages (`@hivelore/core`, `cli`, `mcp`, `embeddings`) are versioned in lockstep.

## Additions in 0.63

Memory frontmatter accepts optional `evidence` (`hypothesis`, `observed`, `reproduced`, `tested`),
`supersedes` (memory IDs), and `checks` (`{path, contains?, excludes?}` objects). Checks use literal
text in current repository files, never shell commands. At least one of `contains`/`excludes` is
required. Check files must resolve inside the project, be regular files and be at most 2 MiB.
These are focused claim checks, not proof of arbitrary Markdown prose. An anchor's continued
existence alone does not establish that a historical decision still describes current code.

MCP `mem_save`/`mem_update` and CLI `memory save`/`memory update` accept these fields (CLI checks use
JSON; supersedes uses CSV). `mem_get` returns the evidence fields and a stale confidence/reason
when a current-file check fails. Explicit `include_stale` retrieval remains available for investigation.
Retiring a claim does not silently disarm an executable sensor; changes to gates retain their review path.

`autoPromoteMinReads` retains its configuration name for compatibility but now counts explicit
confirmed applications (`mem_feedback`), not retrievals. Read thresholds on `deriveConfidence`
remain accepted but do not establish truth. Existing validated memories remain trusted, subject
to freshness decay. Hypotheses never become authoritative through reads or automatic promotion.

`get_briefing.maintenance_notices` contains optional housekeeping. Its `action_required` field
continues to mean an explicit human confirmation is needed.

`enforce session-start --mode read|local|commit|release --session-id <id>` records a task baseline.
CLI and MCP briefings also establish a missing baseline. `enforce finish` accepts the same flags,
then falls back to the session's mode, `enforcement.completionMode`, and finally `release`.
Use the same session ID throughout a task; hooks use the harness session ID. A baseline expires
after 12 hours. A missing baseline or branch change falls back to inspecting the whole worktree;
read completion instead refuses to claim an unchanged task. Completion contracts do not replace
builds or functional tests, and a local finish only reports the policy scan that it actually ran.

## Additions in 0.64

`get_briefing` accepts optional `session_id` and `context_reset`. The reset clears emission and
consultation receipts for that session while preserving its original task baseline. `mem_session_end`
accepts optional `session_id` to checkpoint task progress. Read-only briefing and feedback never
promote or rewrite shared corpus records; promotion remains explicit maintenance.

`agent check --exercise`, `stats outcomes`, `memory feedback --outcome corrected|verified --reference`,
and `benchmark prepare` are additive. Existing applied/rejected feedback remains supported. New
`init --completion-mode` selects a task default; existing configurations are preserved. New projects
default to local completion and draft capture. Project Claude MCP configurations are portable.

`memory verify` still checks the entire corpus by default, but prints only exceptions; `--all` prints
successful checks too and JSON remains complete. `--update` restores stale records to proposed,
not validated: existing anchors cannot validate arbitrary claims. Generated bridge breadcrumbs
now default to zero, with explicit `--max-memories` available. Merge/rewrite hooks no longer mutate
the corpus. See the release migration notes before updating a legacy auto-writing health workflow.
