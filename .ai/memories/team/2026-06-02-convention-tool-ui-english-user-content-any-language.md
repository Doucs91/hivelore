---
id: 2026-06-02-convention-tool-ui-english-user-content-any-language
scope: team
type: convention
status: validated
anchor:
  paths:
    - packages/vscode/package.json
    - packages/vscode/src/observabilityProvider.ts
    - packages/cli/src/index.ts
    - packages/mcp/src/server.ts
    - README.md
  symbols: []
tags:
  - ux
  - language
  - tooling
  - vscode
  - cli
  - mcp
created_at: '2026-06-02T17:14:21.987Z'
expires_when: null
verified_at: '2026-07-02T05:42:00.283Z'
stale_reason: null
related_ids: []
last_read_at: null
topic: tool-ui-language-policy
revision_count: 0
requires_human_approval: false
validated_by: null
---
# hAIve tool UI language policy

All hAIve product/tooling surfaces should use English for built-in UI text, command names, help labels, menu labels, status labels, diagnostic categories, and tool descriptions. This keeps CLI, MCP, VS Code, docs, and automation consistent across teams.

User-authored or repo-authored content may be in any language: memory bodies, project rules, examples, domain vocabulary, team decisions, gotchas, prompts, and generated context should preserve the user's/team's natural language.

When adding new hAIve UI:
- Use English for the tool shell: labels, buttons, headings, commands, diagnostics.
- Do not translate user memory content or rule text.
- Examples may contain non-English user content if they demonstrate that memories/rules are language-agnostic.
