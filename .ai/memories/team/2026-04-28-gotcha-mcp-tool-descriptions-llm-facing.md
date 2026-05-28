---
id: 2026-04-28-gotcha-mcp-tool-descriptions-llm-facing
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - packages/mcp/src/tools/mem-search.ts
  symbols:
    - memSearch
tags:
  - mcp
  - dx
  - llm
  - tool-use
created_at: '2026-04-28T04:18:31.207Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# MCP tool descriptions are LLM-facing — write them for an AI, not a human

The `description` string in `server.tool(name, description, ...)` is sent to the LLM as part of the tool schema.

**Write them as**: 'Use this when you [situation]. It [does X] and returns [Y].'
**Not**: 'Calls the memSearch function with literal OR fallback.'

**Critical for token reduction**: a clear description means the LLM picks the RIGHT tool first time. Ambiguous descriptions cause the LLM to call the wrong tool, check the result, then call the right one — wasting 2-3 extra tool calls per task.

**Current descriptions worth improving**: `mem_save` vs `mem_tried` are still easy to confuse for an LLM — add explicit 'NOT for failed approaches' to mem_save.
