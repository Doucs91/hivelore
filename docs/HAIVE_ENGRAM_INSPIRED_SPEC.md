# Specification - Engram-Inspired, Enforcement-First (hAIve)

## Short Formula

**Durable truth: Git + repo policy** (`.ai/memories/`, PRs, single repo or multi-repo through `crossRepoSources`).
**Borrowed from Engram's spirit:** better **retrieval**, **noise reduction**, and **session continuity**, but in service of a **context enforcement** layer. Memories are the substrate; gates and breadcrumbs are the product promise.

## Two-Layer Model

| Layer | Role | Versioned |
|-------|------|-----------|
| **Context records** | Conventions, decisions, gotchas, architecture; repo-policy breadcrumbs | Yes (Git) |
| **Runtime** | Drafts, machine-local session journal, unshared caches | No (see `.gitignore` under `.ai/.runtime/`) |

## Progressive Disclosure (MCP Tools)

1. **`get_briefing`** - first call: project context, session recap, memories ranked under budget.
2. **`mem_relevant_to`** / **`mem_search`** - targeted exploration; `mem_search` can use **lexical ranking** (`lexical_rank`) for phrase-like queries without a semantic index.
3. **`mem_get`** - full body when an id is known.

## Project Resolution (Multi-Root / Cursor)

- **`mem_resolve_project`** (MCP) and **`haive resolve-project`** (CLI) always return structured JSON and **do not throw** fatal errors: resolved root, `HAIVE_PROJECT_ROOT` if defined, `.ai/` presence, and `memories/` presence.

## Topics (Stable Keys)

- **`mem_suggest_topic`** + **`haive memory suggest-topic`** propose a `topic` key in `family/slug` style (for example `architecture/...`, `bug/...`, `decision/...`) aligned with the memory `type`, for the topic-upsert pattern already present in frontmatter.

## Conflicts

- **`mem_conflicts_with`** remains the primary tool (heuristics + optional semantics).
- **`mem_conflict_candidates`**: a **lightweight scan without a target id**: (1) pairs with high lexical overlap (Jaccard), (2) pairs sharing the same **`topic`** with **validated** x **rejected** statuses. Use `mem_conflicts_with` afterward for serious analysis.

## Timeline

- **`mem_timeline`**: from a **`memory_id`** and/or a **`topic`**, lists related memories (`related_ids`, same `topic`, overlapping anchors), sorted chronologically (`created_at`).

## Runtime Journal (P2)

- Local file: `.ai/.runtime/session-journal.ndjson` (one JSON entry per line).
- **MCP**: `runtime_journal_append`, `runtime_journal_tail`.
- **CLI**: `haive runtime journal append <message>`, `haive runtime journal tail`.
- In autopilot mode, one line is appended when the MCP server **closes** (auto recap + tool summary).

## Phases (Implementation Traces)

| Phase | Content |
|-------|---------|
| **P0** | `mem_resolve_project`, progressive disclosure (descriptions), `mem_suggest_topic`, `.ai/.runtime/` + internal gitignore, `lexical_rank` on `mem_search` - **done** |
| **P1** | `mem_timeline`, `mem_conflict_candidates`, CLI equivalents: `memory timeline`, `memory conflict-candidates`, `resolve-project`, `memory suggest-topic` - **done** |
| **P2** | Runtime journal (**done**); additional **`topic_status_pairs`** signal in `mem_conflict_candidates` / CLI (same `topic`, validated x rejected), without duplicating `mem_conflicts_with` (**done**). |

## Existing Tool Map

- Search: `mem_search`, `mem_relevant_to`, embed index (`semantic`).
- Conflicts by id: `mem_conflicts_with`.
- Briefing / onboarding: `get_briefing`, `get_recap`.
- Hub / multi-repo: config `crossRepoSources`, sync; unchanged by this spec.
