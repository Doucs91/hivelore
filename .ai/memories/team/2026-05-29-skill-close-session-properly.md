---
id: 2026-05-29-skill-close-session-properly
scope: team
type: skill
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - mem_session_end
  - workflow
  - agent-behavior
created_at: '2026-05-29T19:47:47.912Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: skill/close-session
revision_count: 0
requires_human_approval: false
---
# Skill: Close a session properly

**Rule**: before concluding a significant task (> 30 min or > 5 modified files), run the checklist below.

## Checklist before concluding

1. **Failed approaches documented?**
   Mentally replay the session. Were there mistakes/refactors/backtracks?
   If yes and not yet documented: call `mem_tried` now.

2. **Architectural decisions captured?**
   Was there a non-obvious choice (library, pattern, structure)?
   If yes and not yet documented: call `mem_save type=decision` now.

3. **Gotchas discovered?**
   Surprising behavior in code or dependencies?
   If yes and not yet documented: call `mem_save type=gotcha` now.

4. **Call `mem_session_end` with the real fields filled:**

```
mem_session_end(
  goal: "What you were trying to accomplish (1-2 sentences)",
  accomplished: "- bullet 1\n- bullet 2\n...",
  discoveries: "What surprised you, traps encountered, blind spots",  // DO NOT LEAVE EMPTY
  files_touched: ["key modified files"],
  next_steps: "What remains to do",
  scope: "team"  // if this is a shared work session
)
```

5. **Verify that the pipeline passes before saying "done":**
   After pushing the work, wait until all GitHub Actions workflows for the HEAD commit succeed.
   Run `haive enforce finish`; if the gate reports `github-actions-pending`, `github-actions-failed`, `github-actions-runs-missing`, or `github-actions-unverified`, do not close. Wait, inspect logs, fix, then push a new commit if necessary.

## The `discoveries` field is the most important

This is what the next session cannot infer from the git diff. Examples:
- "The pre-commit gate blocks config-only commits because of literal matching"
- "`anchor_paths` in `MemMatch` was empty; the fix was to expose `fm.anchor.paths`"
- "The `level === 'info'` assertion was wrong because `anchorPathTokens` includes path segments"

## Anti-pattern

❌ `mem_session_end(goal: "...", accomplished: "...", discoveries: "")` - a session end with empty discoveries has no value beyond what git log already shows.
