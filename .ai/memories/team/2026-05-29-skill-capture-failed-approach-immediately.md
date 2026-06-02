---
id: 2026-05-29-skill-capture-failed-approach-immediately
scope: team
type: skill
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - mem_tried
  - workflow
  - agent-behavior
created_at: '2026-05-29T19:47:24.597Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: skill/capture-failed-approach
revision_count: 0
requires_human_approval: false
---
# Skill: Capture a failed approach immediately

**Absolute rule**: call `mem_tried` BEFORE fixing. Not after. Not at session end. Before.

## When to trigger (exhaustive list)

| Situation | Concrete example |
|-----------|----------------|
| Nonexistent CLI option | `haive init --yes` -> "unknown option" |
| Import/API that does not exist | `import { X } from "pkg"` -> ERR_MODULE_NOT_FOUND |
| Test fails because of a wrong assumption | Assert `level === "info"` while the logic produces "review" |
| Approach entirely redone (> 15 min lost) | Rewrite a function after misunderstanding the interface |
| Regex/pattern that seems correct but does not match | `/\b(foo)\b/.test(command)` does not match what you think |
| Surprising library behavior you do NOT document | This should be a gotcha, not an attempt |

## How to call

```
mem_tried(
  what: "short description of what was tried",
  why_failed: "the exact error or precise reason",
  instead: "what to do instead",
  paths: ["affected file if relevant"],
  scope: "team"  // if applicable to the whole team, otherwise "personal"
)
```

## Anti-patterns to avoid

- ❌ Fix silently without documenting -> the next session repeats the same mistake
- ❌ Wait until session end -> context is lost and the body will be vague
- ❌ Document only in a code comment -> invisible to other agents
- ❌ "It was an obvious mistake, no need to document" -> what feels obvious now will be forgotten tomorrow
