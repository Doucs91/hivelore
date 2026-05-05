<!-- hAIve bridge file — do not edit by hand. -->
<!-- This file points your AI tool at the shared hAIve project context. -->

See `.ai/project-context.md` for the full project context.
Memories live under `.ai/memories/` (personal/team/module).

## hAIve — mandatory rules for AI agents

Installing or initializing hAIve in this repository means **the team expects AI agents to drive work through hAIve**, not bypass it.

### MCP first (default — never optional unless the developer says so)
The **haive** MCP server must be enabled in your client. Until it is unavailable (misconfiguration report to the developer), you **must** use it for substantive work:

- **Before** you edit project source files, configs (`package.json`, tooling), or workflows for the current goal, invoke `get_briefing` with a short **task** string (and **files** / **symbols** when you know them). If project context was already refreshed in this session and you only need ranked memories, you may call `mem_relevant_to` instead—but **still** consult hAIve before trusting ungrounded guesses.
- **Before** declaring a coding task finished, invoke the MCP prompt `post_task` when the session produced learnings or substantive changes worth capturing.

Do **not** treat these as nice-to-have: they are **default-required** for coding agents here.

### Session rules
- **Immediately** when an approach fails (wrong API, wrong pattern, wrong assumption), call `mem_tried` — do not wait until the end of the session.

### Safety rules — NEVER violate these
- If `get_briefing` returns an `action_required` list, **stop and show each item to the developer** before doing anything. Use the exact `developer_message` provided. Wait for explicit confirmation.
- **Never modify code autonomously** because of a breaking change detected in another project (dependency version bump, API contract change, removed field). Always ask first.
- When in doubt about a cross-repo change: ask, don't act.
