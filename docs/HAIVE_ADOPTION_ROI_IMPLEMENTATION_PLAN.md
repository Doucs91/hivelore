# Plan - Adoption, ROI, Tokens, and IDE Surface (hAIve)

This document lists workstreams derived from technical product recommendations (context enforcement, repo breadcrumbs, context optimization, adoption, friction, PRs, IDE). Each deliverable says where it lives in the monorepo.

## User Goals

| Goal | Mechanism |
|------|-----------|
| Fast value | `welcome` lists foundational decisions/gotchas; stronger hints after `get_briefing` |
| Fewer tokens | Briefing presets (`quick` / `balanced` / `deep`); `actions` breadcrumb format in `get_briefing` |
| Corpus quality | `haive memory lint`; body similarity warning in `mem_save` |
| ROI proof | `haive stats --export-report <file.json>` (aggregates + tool metrics) |
| Team loop | GitHub Action: missing anchor paths at checkout + `haive memory verify` checklist |
| IDE surface | hAIve view moved to the **Activity Bar** + VS Code install / usage docs |

## Implementation Order (Tracking)

1. **Core - presets and body compression**
   - Files: `packages/core/src/briefing-preset.ts`, `packages/core/src/briefing-body.ts`
   - Export: `packages/core/src/index.ts`
   - Tests: `packages/core/test/briefing-preset.test.ts`, `briefing-body.test.ts`

2. **MCP - `get_briefing`**
   - Field `budget_preset?: quick | balanced | deep` (substitutes `max_tokens` / `max_memories` according to the table)
   - `format`: add `actions` (actionable bullet-like lines before applying the memory budget)
   - Additional value-oriented hints / `welcome` or `attempt`
   - Files: `packages/mcp/src/tools/get-briefing.ts`, `packages/mcp/src/server.ts`

3. **MCP - `mem_save`**
   - Text similarity warning (rough Jaccard over tokens) vs other memories in the same scope/type
   - File: `packages/mcp/src/tools/mem-save.ts`

4. **CLI**
   - `haive briefing --budget quick|balanced|deep` - `packages/cli/src/commands/briefing.ts`
   - `haive welcome` - new `packages/cli/src/commands/welcome.ts` + registry in `index.ts`
   - `haive memory lint` - new `packages/cli/src/commands/memory-lint.ts`
   - `haive stats --export-report <path>` - `packages/cli/src/commands/stats.ts`

5. **GitHub Action**
   - List memories whose anchor path matches a modified file **and** the file no longer exists in the workspace
   - Footer: `haive memory verify` reminder
   - File: `packages/github-action/src/run.ts`

6. **VS Code (`packages/vscode`)**
   - New view container in the Activity Bar (dedicated icon), so the "hAIve Memories" view is no longer buried in Explorer
   - Document this section below + update `package.json` `contributes`
   - Files: `package.json`, possible note in `packages/vscode/README.md` if present

## Briefing Presets (Delivered Values)

| Preset | `max_tokens` | `max_memories` | `include_module_contexts` |
|--------|--------------|----------------|---------------------------|
| `quick` | 2500 | 5 | `false` |
| `balanced` | 8000 | 8 | `true` (historical default) |
| `deep` | 16000 | 14 | `true` |

`balanced` reflects the current `get_briefing` defaults before customization.

## Visible VS Code Surface - What Is Planned for You

- **hAIve icon** in the left sidebar (Activity Bar), next to Explorer / Git.
- Open the memory list (existing), current-file filter, CodeLens, and status bar remain.
- **Installation**: open the root folder where `.ai/memories/` exists; the pack is named **`haive-vscode`** under `packages/vscode/`; package it with `pnpm --filter haive-vscode run package`, then use *Install from VSIX* in Cursor/VS Code, or publish to the marketplace later.

## Intentionally Out of Scope (Too Broad for This Batch)

- Full dashboard webview (real-time charts).
- LLM-as-judge memory lint.
- Full cross-repo support beyond `crossRepoSources` / `hub` already planned in config.
- Cloud middleware for signed governance.

These areas remain evolvable and can attach after the PR flow + presets + stats report are validated.

## Implemented (Code Reference)

| Workstream | Main files / commands |
|------------|-----------------------|
| Presets + `actions` format | `packages/mcp/src/tools/get-briefing.ts`, `packages/core/src/briefing-preset.ts`, `packages/core/src/briefing-body.ts` |
| CLI parity | `haive briefing --budget`, `--memory-format`; `packages/cli/src/commands/briefing.ts` |
| Onboarding | `haive welcome` |
| Corpus lint | `haive memory lint` |
| Local ROI export | `haive stats --export-report` |
| GitHub Action | `packages/github-action/src/run.ts` (YAML anchors + broken anchors + footer) |
| IDE | Activity Bar view in `packages/vscode/package.json` + README |
