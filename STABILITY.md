# API stability & the 1.0 stable core

hAIve is still `0.x`. This document declares the **surface we intend to freeze for 1.0** — the
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

### CLI — the golden path (`haive --help`)

| Command | Stable subcommands |
|---|---|
| `haive init` | — |
| `haive doctor` | — |
| `haive agent` | `setup`, `status` |
| `haive briefing` | — |
| `haive bridges` | `list`, `sync` |
| `haive enforce` | `install`, `status`, `check`, `ci`, `finish`, `commit-msg` |
| `haive run` | — |
| `haive sensors` | `list`, `check`, `export`, `promote` |
| `haive sync` | — |
| `haive mcp` | — |
| `haive memory` | `save`, `list`, `search`, `get`, `verify`, `lint`, `tried`, `delete` |
| `haive session` | `end` |

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

Everything reachable only via `haive --advanced` or the `maintenance` / `experimental` MCP profiles.
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

All four publishable packages (`@hiveai/core`, `cli`, `mcp`, `embeddings`) are versioned in lockstep.
