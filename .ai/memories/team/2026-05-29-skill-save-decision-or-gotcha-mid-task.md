---
id: 2026-05-29-skill-save-decision-or-gotcha-mid-task
scope: team
type: skill
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - mem_save
  - workflow
  - agent-behavior
created_at: '2026-05-29T19:47:35.435Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: skill/save-decision-or-gotcha
revision_count: 0
requires_human_approval: false
---
# Skill: Save a decision or gotcha mid-task

**Rule**: if you make a non-obvious choice or discover surprising behavior, call `mem_save` IN THE SAME RESPONSE, not at session end.

## When to trigger

| Situation | Memory type |
|-----------|----------------|
| You choose A instead of B for a non-obvious reason | `decision` |
| You discover unexpected behavior in a library/tool | `gotcha` |
| You create a pattern reused more than once in the session | `convention` |
| You understand WHY part of the code is structured that way | `decision` or `architecture` |
| You find a hidden constraint (performance, security, compatibility) | `gotcha` |

## Minimum threshold for saving

Test question: *"If I come back in 3 weeks, would I repeat the same mistake without this memory?"*
If yes, save it now.

## Decision Template

```
mem_save(
  type: "decision",
  slug: "why-X-instead-of-Y",
  body: "## Decision\nUse X.\n\n## Why\nY causes [specific problem].\n\n## Rejected alternatives\n- Y: [reason]\n",
  paths: ["file where the decision applies"],
  scope: "team"
)
```

## Gotcha Template

```
mem_save(
  type: "gotcha",
  slug: "surprising-behavior-of-X",
  body: "## Trap\nX behaves like Y when Z.\n\n## Impact\n...\n\n## Fix\n...",
  paths: ["affected file"],
  scope: "team"
)
```

## What does NOT deserve a memory

- Obvious behavior documented in the official docs
- Style choice with no logic impact
- Fixing a typo or trivial bug
