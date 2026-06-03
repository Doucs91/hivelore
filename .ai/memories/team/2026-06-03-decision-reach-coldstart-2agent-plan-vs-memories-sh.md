---
id: 2026-06-03-decision-reach-coldstart-2agent-plan-vs-memories-sh
scope: team
type: decision
status: validated
anchor:
  paths:
    - packages/core/src/bridges.ts
    - packages/cli/src/commands/bridges.ts
    - packages/cli/src/commands/init-stack-packs.ts
    - packages/cli/src/commands/ingest.ts
  symbols: []
tags:
  - strategy
  - reach
  - cold-start
  - bridges
  - competitive
  - roadmap
created_at: '2026-06-03T22:13:56.447Z'
expires_when: null
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
## Reach + cold-start improvement plan vs memories.sh (2-agent split)

Best competitor = **memories.sh** (commercial SaaS, free local tier). Surfaces+generates native configs for 13+ agents (Cursor `.cursor/rules/*.mdc` with glob frontmatter, CLAUDE.md, Copilot, Windsurf `.windsurf/rules/`, Cline, Roo `.roo/rules/`, AGENTS.md/Codex, Gemini). 4 memory lanes (session/semantic/episodic/procedural), SQLite+embeddings, MCP. **It only surfaces — no enforcement.** hAIve's edge stays: bridges carry **block sensors**, not just memory injection.

### Reach gaps found (Track A — owns reach files)
- hAIve bridges had 7 targets but **NO Cursor memory bridge** (only a static `.cursor/rules/haive-mcp-required.mdc` from init). **FIXED**: added `cursor` target → `.cursor/rules/haive-memories.mdc` (native `.mdc` frontmatter `alwaysApply:true`, markers preserved for idempotent sync). core/bridges.ts + cli/commands/bridges.ts, 28 core + 67 cli tests green.
- Still TODO: path-scoped Cursor `.mdc` split (globs from `anchor.paths` — needs `paths` on `BridgeMemoryEntry`); modern dir paths (`.windsurf/rules/`, `.clinerules/` dir, `.roo/rules/`); new targets (Roo, Gemini, Aider CONVENTIONS.md); unify CLAUDE.md (today via `sync --inject-bridge`) into the `bridges` pipeline; auto-run `bridges sync` on `enforce finish`/post-session so bridges never go stale.

### Cold-start gaps (Track B — owns cold-start files)
Already exists: `init --seed` (git revert/hotfix → drafts via `seedFromGitHistory`), 20 stack packs (init-stack-packs.ts, auto-detected), `haive ingest` (SARIF + Sonar file/API → anchored drafts), import-changelog/import/seed-git.
- TODO: more stack packs (Tailwind, Vite, SvelteKit, Astro, Laravel, Rails, .NET, Docker/k8s, turbo/nx monorepo, TS-generic); broaden `ingest` (generic ESLint JSON, tsc errors, npm audit, TODO/FIXME scan, test failures); richer git seeding (fix/workaround/hack heuristics beyond revert/hotfix; PR review comments via `gh`); first-session "value report" (what was seeded/caught) for early visibility.

### Multi-agent safety
Split by **file ownership** so the 2 agents never touch the same files → no merge conflicts. Track A = bridges/sync/core-bridges. Track B = init-stack-packs/ingest/seed/findings. Version bump in lockstep at the end (whoever finishes last, or Sady). Follow [[2026-05-31-decision-git-sync-protocol-multi-agent]]; agents never npm publish.

**Why:** battle plan ([[2026-06-03-decision-competitive-positioning-battle-plan]]) names reach + cold-start as the two adoption levers where hAIve is "good, not ahead" — closing them is the single highest-leverage adoption work.

### STATUS 2026-06-03 — ALL SHIPPED SOLO (no second agent; Sady reassigned to one agent)
Reach (`bridges` now 12 targets): added **claude, cursor (`.mdc` alwaysApply), roo (`.roo/rules/haive.md`), gemini (`GEMINI.md`), aider (`CONVENTIONS.md`)**; path-scoping = `paths` on `BridgeMemoryEntry`, anchor paths rendered inline ("applies to: …") on every target; CLAUDE.md unified into the bridges pipeline; **A5** = `haive sync` auto-refreshes existing native bridges (`--no-bridges` to skip) via the new shared `packages/cli/src/utils/bridge-files.ts` (used by both `bridges sync` and `sync` — marker helpers no longer duplicated in `bridges.ts`).
Cold-start: **10 new stack packs** (tailwind, vite, sveltekit, astro, typescript, monorepo, laravel, rails, dotnet, docker) in init-stack-packs.ts + detection in `core/seed.ts` (`DetectableStack`, new manifests: composer.json/Gemfile/.csproj-flag/Dockerfile-flag/turbo.json/nx.json) wired in init.ts `autoDetectStacksFromRoot`; **`haive ingest --from eslint|npm-audit`** (new `parseEslintJson` w/ cwd-relativize + `parseNpmAudit` in `core/findings.ts`, `parseFindings` now `(format,input,{cwd?})`); seed-git gained a **`workaround`** kind (`WORKAROUND_RE`: workaround/hack/band-aid/FIXME/stop-gap); first-session report shows a reach hint.
Verified: 322 core + 67 cli + 122 mcp tests green, tsc clean on all 3, functional smoke (init --stack auto detects next/tailwind/ts/monorepo/docker; bridges sync --all writes 12; ingest eslint/npm-audit; sync refreshes 10). **NOT committed/pushed** — left to Sady (coordination); needs lockstep version bump + tag per [[2026-05-31-decision-git-sync-protocol-multi-agent]].
