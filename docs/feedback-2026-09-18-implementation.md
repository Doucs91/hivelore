# Client feedback → Hivelore 0.63

The seven September 18 reports describe several sessions on the same client project, including
implementation, review, deployment and rename work. They are useful concrete observations, not
seven independent benchmarks. The product remains focused on repository-specific knowledge that
changes an agent's decisions and executable rules that prevent a repeated mistake.

## Changes

| Reported problem | Implemented behavior | Regression coverage |
| --- | --- | --- |
| A long recap/context consumes a briefing before the useful rule appears | Memories first in CLI/session hooks; shared MCP body budget; short, dated recaps; quick output drops repeated navigation | MCP feedback regressions; CLI briefing integration |
| Repetition makes an old claim appear authoritative | Retrieval counts measure exposure only; verification controls age; explicit evidence controls authority | Core confidence tests |
| An old migration still exists but no longer describes reality | Optional assertions against a current file; contradicted claims excluded from automatic context and explained on explicit lookup | Core evidence and MCP feedback tests |
| Conflicting old/new memories | Explicit `supersedes`; hypotheses and contradicted replacements cannot suppress current knowledge; cycles stay visible | Core evidence and MCP feedback tests |
| Finish blocks on another person's existing changes | Task snapshot compares content and index fingerprints; only identical pre-existing state is excluded | CLI task attribution integration |
| Reading or local experimentation requires a release | Explicit completion contracts, keeping existing release defaults | CLI task completion integration |
| Hooks announce generic advice repeatedly and miss scripts | Quiet without a new file-specific rule; per-session consultation; Git-based post-tool change detection | CLI task context and hook integration |
| Rename maintenance becomes manual busywork | `sync` repairs exact `R100` Git renames, including literal sensor/check paths; does not stage files or overwrite pending memory edits | CLI rename integration |
| Bootstrap and recap housekeeping interrupt the task | Advisory maintenance notices; human approval requests remain distinct | MCP tools and approval tests |
| Logs omit tools and misrepresent usage | Central MCP call recording, explicit reads in `mem_get`, CLI briefing events | MCP tests and session accounting tests |
| A local green gate overlooks new files or deletions | Local diff includes untracked files; presence sensors examine final content for the correct stage | CLI local policy and existing sensor integration |
| PR comments repeat the same memory under many files | Global deduplication, five unique memories by default, bounded excerpts/output | GitHub action comment budget tests |
| A failed integration is labelled transient without evidence | Advisory classification is no longer a diagnosis; configured required workflows stay mandatory | CLI CI verification integration |

## Task completion

```bash
# Start before making edits; use a distinct ID for concurrent work.
hivelore enforce session-start --task "Inspect transaction handling" --mode read --session-id inspect
hivelore enforce finish --session-id inspect

hivelore enforce session-start --task "Fix transaction handling" --mode local --session-id fix
# Edit and run the project's tests.
hivelore enforce finish --session-id fix
```

| Contract | Completion condition |
| --- | --- |
| `read` | A recent baseline exists on the same branch, with unchanged worktree and HEAD |
| `local` | The task's local policy scan passes; edits may remain uncommitted |
| `commit` | The task's changes are committed; no push/release requirement |
| `release` | Existing commit, push, version/tag and CI protocol |

Configure the repository default in `enforcement.completionMode`. Do not change a repository's
release policy merely to bypass a failure. Without a baseline, the gate conservatively inspects
the whole worktree. Baselines are local metadata, expire after 12 hours, and contain fingerprints,
not copies of source files. Editing the same file as a colleague makes that file part of the task;
Hivelore does not claim line-by-line authorship inside a shared file.

## Evidence against current state

```yaml
evidence: tested
checks:
  - path: src/schema.sql
    contains: CREATE TABLE current_name
    excludes: CREATE TABLE old_name
supersedes:
  - 2026-09-01-decision-old-schema-name
```

The current-file check is separate from an anchor to a historical migration. No arbitrary command
is executed to evaluate these checks. They verify the stated literal assertion, not every claim in
the memory. Execution-based invariants belong in the existing test/shell sensors with their proof
and review process. `sync`/`memory verify` remain the explicit corpus maintenance tools; a CLI
briefing no longer rewrites corpus/context or builds a semantic index as a side effect of reading.
Enforcement likewise leaves corpus maintenance explicit: automatic corpus edits could otherwise be
staged and incorrectly treated as self-authored policy, bypassing consultation coverage.

## Boundaries still requiring real-world evidence

- Re-run the improved hooks in the reporting client's deployment and rename workflows to measure
  interruptions, latency and useful outcomes. Local regression tests do not establish adoption or ROI.
- Correct project-specific knowledge and sensor scopes in the client repository with that team's
  current code and intent. These reports alone do not authorize edits to another repository.
- Compound renames with changed content remain reviewable suggestions. Hivelore does not guess
  replacements from similar filenames or globally widen a sensor after an incident.
- Branch protection is not inferred from workflow names. Set `enforcement.requiredCiWorkflows`
  to include integrations your team requires; inspect actual failed logs before diagnosing a cause.
- Hooks can identify file effects in a shared worktree, but cannot prove which concurrent process
  wrote a file. Use distinct sessions/worktrees where attribution matters.

No existing feature was removed solely because these reports contain few recorded calls to it.
No benchmark advantage or production reliability improvement is claimed from these changes alone.
