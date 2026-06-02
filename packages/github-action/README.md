<p align="center">
  <a href="https://github.com/Doucs91/hAIve">
    <img src="https://raw.githubusercontent.com/Doucs91/hAIve/main/packages/vscode/media/logo.svg" alt="hAIve logo" width="96" />
  </a>
</p>

# hAIve PR Memory Check — GitHub Action

Automatically surfaces relevant team memories, gotchas, and conventions in every pull request. Posts a structured comment so reviewers and AI agents never miss non-obvious constraints.

## What it looks like

```
## 🧠 hAIve — Team Memory Check

> ⚠️ 2 memory(ies) require human confirmation before AI agents can act on them.

<details>
<summary>⚠️ Breaking change: DELETE /users/:id removed  `team/gotcha`  🚨 action required</summary>
…
</details>

---

**4 memories relevant to this PR** (across 2 files):

### `src/models/db.ts`

<details>
<summary>🏗️ DB - always call migrate() at startup  `team/convention`</summary>
src/models/db.ts exposes migrate(). It must be awaited before app.listen()...
</details>

<details>
<summary>🎯 UUID as PK - never use sequential integers  `team/decision`</summary>
Use gen_random_uuid() for all tables...
</details>
```

## Setup

Add to `.github/workflows/haive-pr-check.yml` in your project:

```yaml
name: hAIve PR Memory Check
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write
  contents: read

jobs:
  memory-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: Doucs91/hAIve/packages/github-action@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `github-token` | ✅ | — | GitHub token (`secrets.GITHUB_TOKEN`) |
| `haive-version` | | `latest` | Version of `@hiveai/cli` to install |
| `comment-header` | | `## 🧠 hAIve — Team Memory Check` | Comment header text |
| `post-if-empty` | | `false` | Post comment even when no memories found |
| `max-memories` | | `10` | Max memories shown per file |
| `memories-dir` | | `.ai/memories` | Path to memories directory |

## Outputs

| Output | Description |
|---|---|
| `memories-found` | Number of unique memories surfaced |
| `action-required-count` | Memories requiring human confirmation |
| `comment-url` | URL of the posted PR comment |

## Advanced: fail PR on action_required

```yaml
- uses: Doucs91/hAIve/packages/github-action@main
  id: haive
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}

- name: Block merge if action required
  if: steps.haive.outputs.action-required-count > 0
  run: |
    echo "::error::${{ steps.haive.outputs.action-required-count }} memory(ies) require human review before merging."
    exit 1
```
