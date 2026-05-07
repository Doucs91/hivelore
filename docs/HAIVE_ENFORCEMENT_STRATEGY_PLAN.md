# hAIve Enforcement Strategy Plan

## Goal

Reposition hAIve from a general-purpose AI memory server into a Git-native enforcement layer for AI coding agents.

The product promise should become:

> AI agents cannot safely change a repo until they have loaded the team's relevant decisions, gotchas, failed attempts, and stale-memory warnings.

This is stronger than "persistent memory". It makes hAIve infrastructure: a briefing gate, PR guardrail, and auditable team-memory system.

## Product Positioning

### Keep

- Git-native Markdown memories in `.ai/memories/`
- `get_briefing` as the default first step before edits
- Anchors to paths/symbols
- Stale detection
- Failed-attempt memory via `mem_tried`
- PR/CI surfacing
- Minimal VS Code visibility

### De-emphasize

- General memory graph exploration
- Broad observability/runtime journal commands
- Experimental anti-pattern and conflict analysis tools
- TUI/dashboard work until core enforcement is validated
- Semantic search as a headline feature; keep it optional

## Enforcement Ladder

### Level 1: Advisory

Current state: bridge files (`CLAUDE.md`, Cursor rules, Copilot instructions) tell agents to use hAIve.

Problem: agents can ignore advisory instructions.

Keep this level, but stop treating it as sufficient.

### Level 2: Automatic Context Injection

Use agent hooks to inject briefing context automatically.

Priority implementation:

- `haive install-hooks --claude`
- Generate `.claude/settings.json` hooks:
  - `SessionStart`: inject `haive briefing --format actions --budget-preset quick`
  - `UserPromptSubmit`: optionally inject `mem_relevant_to` based on prompt text

Success criteria:

- A new Claude Code session receives hAIve context without the agent deciding to call a tool.
- Hook output is compact enough not to annoy users.

### Level 3: Pre-Edit Blocking

Use `PreToolUse` hooks to block edits when no briefing marker exists for the session.

Implementation:

- Add a local runtime marker under `.ai/.runtime/sessions/<agent-session-id>/briefing.json`
- `SessionStart` or first `UserPromptSubmit` writes marker after briefing injection
- `PreToolUse` blocks `Edit`, `Write`, and dangerous `Bash` write patterns if marker is missing
- Error message tells the agent exactly what to run:
  - `Run haive briefing --task "<current task>" before modifying files.`

Initial scope:

- Claude Code first
- Then Cursor/Windsurf/Continue if their hook/rule systems expose comparable gates

Success criteria:

- An agent cannot write files in Claude Code without a briefing marker.
- The block is easy to resolve and does not trap the user.

### Level 4: MCP Session Policy

Make the MCP server policy-aware.

Implementation:

- Add `enforcement.requireBriefingFirst` to `.ai/haive.config.json`
- Track per-MCP-session whether `get_briefing` or `mem_relevant_to` was called
- Return a structured error from non-read/non-bootstrap hAIve tools if briefing is missing

Important limitation:

This does not block file edits by itself. It only enforces hAIve tool order. It should complement hooks, not replace them.

### Level 5: Git/PR Enforcement

Turn hAIve into a required quality gate.

Implementation:

- `haive precommit --block` should become the recommended default in team mode
- GitHub Action should support a required check mode:
  - Fail if changed files have `requires_human_approval` memories
  - Warn or fail if relevant validated gotchas/decisions were not surfaced
  - Fail if changed files invalidate anchors and stale memories are not updated

Success criteria:

- hAIve can block unsafe PRs with a clear, auditable reason.
- Reviewers see relevant team memory without asking the agent.

## MCP Tool Simplification

Current MCP surface: 35 tools + 3 prompts.

Target public surface for v1 enforcement: 10 tools + 2 prompts.

### Tier 1: Core Public Tools

Keep as first-class documented tools:

- `get_briefing`
- `mem_save`
- `mem_tried`
- `mem_search`
- `mem_get`
- `mem_update`
- `mem_verify`
- `mem_relevant_to`
- `code_map`
- `pre_commit_check`

Keep prompts:

- `bootstrap_project`
- `post_task`

### Tier 2: Hide From Default Docs

Keep internally or mark advanced:

- `mem_list`
- `mem_for_files`
- `get_project_context`
- `bootstrap_project_save`
- `mem_session_end`
- `get_recap`
- `mem_suggest_topic`
- `mem_timeline`
- `mem_diff`
- `mem_pending`
- `mem_approve`
- `mem_reject`
- `mem_delete`
- `code_search`

Reason:

Useful, but not necessary for the enforcement promise. They create cognitive noise for agents.

### Tier 3: Experimental / Candidate For Removal Or Plugin

Move behind an experimental flag, split into a separate package, or remove:

- `mem_observe`
- `why_this_file`
- `why_this_decision`
- `anti_patterns_check`
- `mem_distill`
- `mem_conflicts_with`
- `mem_conflict_candidates`
- `runtime_journal_append`
- `runtime_journal_tail`
- `pattern_detect`

Reason:

These tools pull hAIve toward general agent observability and analysis. They may be valuable later, but they dilute the current product.

### Tool Registration Plan

Add MCP tool profiles:

- `HAIVE_TOOL_PROFILE=enforcement`:
  - Registers only Tier 1 tools plus required prompts
- `HAIVE_TOOL_PROFILE=full`:
  - Registers all current tools
- Default new installs to `enforcement`
- Existing installs can stay `full` for backwards compatibility until v1

This is safer than deleting tools immediately.

## CLI Simplification

Target top-level CLI:

- `haive init`
- `haive mcp`
- `haive briefing`
- `haive sync`
- `haive precommit`
- `haive doctor`
- `haive install-hooks`
- `haive memory ...`

Target `haive memory` commands:

- `add`
- `tried`
- `query`
- `show`
- `update`
- `verify`
- `list`
- `rm`

Move to advanced/hidden:

- `suggest`
- `suggest-topic`
- `timeline`
- `conflict-candidates`
- `archive`
- `digest`
- `hot`
- `pending`
- `approve`
- `reject`
- `auto-promote`
- `import`
- `import-changelog`
- `for-files`
- `stats`
- `edit`
- `promote`
- `lint`

Keep hidden commands callable for one release cycle before deciding whether to remove.

## 90-Day Execution Plan

### Weeks 1-2: Stabilize

- Keep typecheck, tests, and build green.
- Remove stale version references from docs.
- Add `shared` scope path support consistently.
- Add an automated "version consistency" check:
  - Root version must match core/cli/mcp/embeddings.
  - `.ai/project-context.md` current version must match package version.

### Weeks 3-4: Enforcement MVP

- Implement `haive install-hooks --claude`.
- Generate Claude Code `SessionStart` briefing injection.
- Generate Claude Code `PreToolUse` edit blocker.
- Add `.ai/.runtime` marker management.
- Add `haive doctor` checks for hook installation.

### Weeks 5-6: Tool Profile

- Add MCP registration profiles.
- Default new projects to `HAIVE_TOOL_PROFILE=enforcement`.
- Update README to document the 10-tool public surface.
- Hide experimental tools from default docs.

### Weeks 7-8: PR Gate

- Add GitHub Action required-check mode.
- Fail on action-required memories for changed files.
- Fail on stale anchor invalidation when `--block` is enabled.
- Produce concise PR comments grouped by changed file.

### Weeks 9-10: Field Validation

- Onboard 5-10 real teams/repos.
- Measure:
  - Number of blocked unsafe edits
  - Number of relevant memories surfaced in PRs
  - Number of repeated failed attempts avoided
  - Whether users keep hooks enabled after 30 days

### Weeks 11-12: Decide

If retention is strong:

- Double down on hAIve enforcement.
- Polish onboarding, docs, and GitHub Marketplace flow.

If retention is weak:

- Pivot using the same assets toward AI agent governance or PR compliance.

## Definition Of Success

hAIve is in the right direction when users describe it like this:

- "It stopped the agent before it edited blindly."
- "It reminded us of a decision during PR review."
- "It prevented the same failed approach from happening again."
- "It made our AI usage auditable without adding a heavy platform."

If users only describe it as "a memory database", the positioning is still too broad.
