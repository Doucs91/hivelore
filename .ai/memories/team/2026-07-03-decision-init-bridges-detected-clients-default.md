---
id: 2026-07-03-decision-init-bridges-detected-clients-default
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/src/utils/bridge-detect.ts
    - packages/cli/src/commands/init.ts
    - packages/cli/src/commands/memory-lint.ts
  symbols: []
tags:
  - init
  - bridges
  - dx
  - first-hour
created_at: '2026-07-03T13:48:18.807Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
topic: init-bridge-target-detection
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# init generates bridges only for detected clients (default `--bridge-targets auto`)

## Decision
`hivelore init` no longer writes all 12 agent bridge files. The default resolves targets by
detection: machine signals (home config dirs like `~/.claude`, `~/.cursor`, `~/.gemini`,
`~/.codeium/windsurf`, VS Code extension ids for copilot/cline/roo/cody), env vars of the
currently-running agent (CLAUDECODE, CURSOR_AGENT, GEMINI_CLI, AIDER_MODEL), and bridge files
already present in the repo. AGENTS.md is ALWAYS generated (cross-tool standard). `--bridge-targets
all` restores full generation; `bridges sync --all` regenerates any time.

## Why
Field test on fresh clones: init dropped 14 files at the repo root; for a Claude-only developer 11
of them are pure `git status` noise and read as spam — the first impression of the product. Reach
is preserved where it matters: the machine that runs init is nearly always the machine running the
agent, so detection covers the real audience, and AGENTS.md covers everyone else.

## How to apply
Detection lives in `packages/cli/src/utils/bridge-detect.ts` (`detectBridgeTargets(root, env, home)`
— env/home injectable for tests). Adding a new client = one entry in HOME_SIGNALS /
VSCODE_EXTENSION_SIGNALS / ENV_SIGNALS. The Cursor MCP-nudge rule (`writeCursorHaiveRule`) is only
written when cursor is a target. Tests: `packages/cli/test/first-hour.test.ts`.

Related: the stack-pack noise fix shipped in the same release (0.34.0) — nested-manifest stack
detection skips playground/examples/fixtures/docs/`template-*` dirs, and stack-pack seeds are never
auto-anchored by the corpus lint fix (they stay background until deliberately anchored).
