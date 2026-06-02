<!-- hAIve bridge file — do not edit by hand. -->

This repo uses **hAIve** for shared context. The map:

- `.ai/project-context.md` — project overview, architecture, conventions.
- `.ai/memories/` — decisions, gotchas, conventions, failed attempts (personal/team/module).
- The breadcrumbs injected below (if any) are the top current memories.

## Working through hAIve

1. **Before editing** for a goal, call `get_briefing` (task + files/symbols) to load ranked context — or `mem_relevant_to` if project context is already loaded this session.
2. **When an approach fails**, call `mem_tried` right away so the next agent skips the dead end.
3. **Before closing** a substantive session, run the `post_task` prompt to capture what was learned.
4. **Before final response**, run `haive enforce finish`. If it blocks, commit/push, bump/tag shippable releases, wait for GitHub Actions to pass when applicable, then rerun it.

If the haive MCP server is not available, tell the developer rather than silently skipping it.

## Safety

- If `get_briefing` returns `action_required`, surface each item to the developer (use its `developer_message`) and wait for confirmation before changing code.
- Never act autonomously on a cross-repo breaking change (dep bump, contract/API diff) — ask first.
