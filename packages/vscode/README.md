# hAIve — VS Code Extension

Surface team memories, gotchas, and architectural decisions **inline while you code**. Never let your AI agent forget what your team knows.

## Features

### 🧠 Inline CodeLens
Files with anchored memories show a count at the top:

```
🧠 hAIve: 3 memories — ⚠️ 1 gotcha · 🏗 1 architecture · 📐 1 convention
  ⚠️  pg Pool — must set max:5 in production
  🏗  DB — toujours appeler migrate() au démarrage
  📐  UUID comme PK — jamais d'entiers séquentiels
```

Click any lens to jump to the memory file.

### 📋 Activity bar sidebar
Browse memories from the dedicated **hAIve** icon in the **Activity Bar** (left strip). Memories are grouped by type; when you edit a file, the tree prioritizes anchors tied to that path.

Older builds placed the panel under Explorer — the activity bar placement keeps institutional knowledge one click away.

Example tree:

```
⚠️ Action Required (2)
  └─ Breaking change: DELETE /users/:id removed
  └─ express ^4 → ^5 major bump
📄 This File (db.ts) (2)
  └─ DB migrations on startup
  └─ UUID primary keys
🏗 Architecture (2)
📐 Conventions (3)
🎯 Decisions (1)
⚠️ Gotchas (4)
```

### 🔴 Status Bar
Bottom status bar shows total memories and flags action_required:

```
⚠️ hAIve: 9 memories · 2 action required
```

### ⚡ Auto-reload
The extension watches `.ai/memories/**` and refreshes automatically when you run `haive memory add`, `haive sync`, or edit memory files directly.

## Requirements

- `haive init` must have been run in the workspace (creates `.ai/memories/`)
- Node.js ≥ 20 (for the `haive` CLI, optional — extension reads files directly)

## Installation

### From VSIX (local build)
```bash
cd packages/vscode
pnpm install
pnpm build
npx vsce package
code --install-extension haive-vscode-*.vsix
```

### From Marketplace
> Coming soon — `ext install hiveai.haive-vscode`

## Settings

| Setting | Default | Description |
|---|---|---|
| `haive.showCodeLens` | `true` | Show inline memory count |
| `haive.showStatusBar` | `true` | Show status bar item |
| `haive.memoriesDir` | `.ai/memories` | Memories directory path |
| `haive.highlightActionRequired` | `true` | Warning decoration on files with action_required |

## Commands

| Command | Description |
|---|---|
| `hAIve: Refresh Memories` | Reload memories from disk |
| `hAIve: Show Memories for This File` | Filter sidebar to current file |
| `hAIve: Add Memory…` | Quick-add a memory via guided input |
| `hAIve: Initialize in This Workspace` | Run `haive init` in terminal |
