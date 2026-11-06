---
id: 2026-11-06-gotcha-claude-code-session-id-env-var
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/core/src/task-session.ts
    - packages/cli/test/setup-env.ts
    - packages/mcp/test/setup-env.ts
  symbols:
    - sessionIdFromEnv
    - sessionIdentity
sensor:
  kind: regex
  pattern: process\.env\.CLAUDE_SESSION_ID
  paths:
    - packages/cli/src/
    - packages/mcp/src/
    - packages/core/src/
  message: Do not read process.env.CLAUDE_SESSION_ID directly — Claude Code never sets it (it exports CLAUDE_CODE_SESSION_ID). Use sessionIdFromEnv() / sessionIdentity() from @hivelore/core so hooks and CLI calls agree on the session.
  incident: 'field reports #10 §3, #11 §1 (finish told the agent to commit the developer''s WIP)'
  severity: block
tags:
  - session
  - claude-code
  - env
  - finish
created_at: '2026-11-06T07:13:34.671Z'
evidence: reproduced
validated_by: auto
---
# Claude Code exports CLAUDE_CODE_SESSION_ID, not CLAUDE_SESSION_ID

Rule: resolve the agent session with `sessionIdFromEnv()` (core/task-session.ts), never by reading `process.env.CLAUDE_SESSION_ID` directly.

Claude Code sets `CLAUDE_CODE_SESSION_ID` in every Bash tool call, and its value equals the `session_id` field of hook payloads. Until 0.66 Hivelore read only `CLAUDE_SESSION_ID` (never set), so the SessionStart hook stored the task baseline under the real UUID while every CLI call from the agent (`enforce finish`, `briefing`, `check --session`) looked under `default`. Effect: `finish` attributed the developer's pre-existing WIP to the task and told the agent to commit and push it (field reports #10 §3, #11 §1).

Second trap: test suites run from inside a Claude Code session inherit the variable. `packages/cli/test/setup-env.ts` and `packages/mcp/test/setup-env.ts` delete the session env vars so fixtures stay on the `default` session.
