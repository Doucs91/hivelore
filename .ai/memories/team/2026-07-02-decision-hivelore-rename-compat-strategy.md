---
id: 2026-07-02-decision-hivelore-rename-compat-strategy
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/cli/package.json
    - packages/cli/src/commands/init-mcp-setup.ts
    - packages/cli/src/commands/install-hooks.ts
    - packages/cli/src/commands/dev-link.ts
  symbols: []
tags:
  - rename
  - hivelore
  - compat
  - release
  - naming
created_at: '2026-07-02T15:08:31.011Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: auto
---
# hAIve → Hivelore rename: what changed vs what deliberately did NOT (v0.30.0)

**Renamed (user-visible identity):** brand Hivelore, npm scope `@hivelore/*`, binaries `hivelore`/`hivelore-mcp` (with `haive`/`haive-mcp` kept as alias bins in the same packages), MCP server identity `hivelore`, generated MCP config key `"hivelore"`, VS Code extension `hivelore.hivelore-vscode` with `hivelore.*` settings/commands, GitHub repo `Doucs91/hivelore`.

**Deliberately unchanged (file-format layer — breaking these would orphan every existing install):** `.ai/` dir, `haive.config.json`, `haive-*.yml` workflow filenames, bridge marker comments `<!-- haive:… -->`, `.cursor/rules/haive-*.mdc` / `.roo/rules/haive.md` generated filenames, `merge=haive` git-driver key, `HAIVE_*` env vars, MCP tool names, internal code identifiers (resolveHaivePaths, HaiveContext, __HAIVE_VERSION__).

**Transition rules encoded in code:**
- Generated git hooks resolve the CLI via a probe: `hivelore` → `haive` → local node_modules bins (both generators: install-hooks.ts AND enforce.ts installEnforcementHooks — they are separate!).
- MCP config writers write key `"hivelore"`; user-level writers treat an existing `"haive"` key as already_configured; project-level writers delete the legacy key and write the new one.
- doctor PATH checks probe both binary names; dev-link hot-swaps into both `@hivelore` and legacy `@hiveai` global scopes.
- The `--advanced` help filter matches `parentName === "hivelore"` — it broke silently on rename because it compared against the commander program name (gotcha for any future rename).

**Renames on npm/marketplace are Sady's manual steps:** publish 0.30.0 under `@hivelore/*`, `npm deprecate @hiveai/*`, create the `hivelore` VS Code publisher. On this dev machine `~/.local/bin/{hivelore,haive}` are symlinks to the repo's `packages/cli/dist/index.js` (replaces the old @hiveai hot-swap, which cannot resolve `@hivelore/core` imports).
