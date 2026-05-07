# @hiveai/core

> Internal library — policy, memory, anchor, and enforcement primitives for hAIve.

This package is consumed by `@hiveai/cli` and `@hiveai/mcp`. You do **not** need to install it directly unless you are building a custom hAIve integration or extending the tool.

---

## What this package provides

### Enforcement primitives

Core owns the durable types and local runtime markers used by hAIve policy gates:

- `.ai/haive.config.json` config loading/merging
- strict enforcement settings (`requireBriefingFirst`, session recap, memory verification, stale-decision blocking)
- briefing markers under `.ai/.runtime/enforcement/briefings/`
- anchor verification for stale decisions and gotchas
- path resolution for project, memory, runtime, and module directories

### Memory schema (Zod)

A single source of truth for the memory frontmatter format:

```typescript
import { MemoryFrontmatterSchema, MemoryTypeSchema, MemoryScopeSchema } from "@hiveai/core";

// Types
type MemoryType  = "convention" | "decision" | "gotcha" | "architecture" | "glossary" | "attempt";
type MemoryScope = "personal" | "team" | "module";
type MemoryStatus = "draft" | "proposed" | "validated" | "stale" | "rejected" | "deprecated";
```

Each memory file is a Markdown file with YAML frontmatter:

```yaml
---
id: 2025-01-15-gotcha-flyway-strict
scope: team
type: gotcha
status: validated
anchor:
  paths:
    - src/main/resources/db/migration
  symbols: []
tags: [flyway, database, migration]
domain: database
author: dev@example.com
created_at: "2025-01-15T10:30:00.000Z"
verified_at: "2025-01-20T08:00:00.000Z"
related_ids:
  - 2025-01-15-attempt-modify-existing-migration
expires_when: null
stale_reason: null
---

# Flyway strict mode — never modify existing migrations

...
```

### Parser / Serializer

```typescript
import { parseMemory, serializeMemory, buildFrontmatter, newMemoryId } from "@hiveai/core";

// Parse a memory file
const memory = parseMemory(rawMarkdown);

// Serialize back to disk
const markdown = serializeMemory(memory);

// Build a new frontmatter object
const frontmatter = buildFrontmatter({
  type: "gotcha",
  slug: "flyway-strict",
  scope: "team",
  paths: ["src/main/resources/db/migration"],
  tags: ["flyway"],
});

// Generate a canonical ID
const id = newMemoryId("gotcha", "flyway-strict"); // "2025-01-15-gotcha-flyway-strict"
```

### Anchor verification

```typescript
import { verifyAnchor } from "@hiveai/core";

const result = await verifyAnchor(memory, { projectRoot: "/path/to/project" });
// result.stale          — true if anchor paths or symbols no longer exist
// result.reason         — human-readable explanation
// result.possibleRenames — files with the same basename found elsewhere (rename detection)
```

### Literal search

```typescript
import { tokenizeQuery, literalMatchesAllTokens, literalMatchesAnyToken } from "@hiveai/core";

const tokens = tokenizeQuery("flyway migration strict");
const matches = memories.filter(({ memory }) => literalMatchesAllTokens(memory, tokens));
```

### Token budgeting

```typescript
import { allocateBudget, estimateTokens, truncateToTokens } from "@hiveai/core";

const slices = allocateBudget(
  [
    { key: "context", text: projectContext, weight: 3, mode: "head" },
    { key: "memories", text: memoriesText, weight: 4, mode: "head" },
  ],
  8000, // max tokens
);
```

### Usage / confidence tracking

```typescript
import { loadUsageIndex, trackReads, deriveConfidence, isDecaying, DECAY_DAYS } from "@hiveai/core";

const index = await loadUsageIndex(paths);
const usage = getUsage(index, memoryId);
const confidence = deriveConfidence(frontmatter, usage);
// confidence: "authoritative" | "trusted" | "provisional" | "low" | "stale"

const decaying = isDecaying(usage, frontmatter.created_at); // not read in >90 days
```

### Path helpers

```typescript
import { findProjectRoot, resolveHaivePaths, memoryFilePath } from "@hiveai/core";

const root  = findProjectRoot();            // Walks up from cwd looking for .ai/ or .git/
const paths = resolveHaivePaths(root);
// paths.memoriesDir, paths.teamDir, paths.personalDir, paths.moduleDir, paths.projectContext, ...

const file = memoryFilePath(paths, "team", "2025-01-15-gotcha-flyway", undefined);
```

---

## Memory file format

Memories are plain Markdown files stored in `.ai/memories/<scope>/` and committed to git:

```
.ai/
└── memories/
    ├── personal/     # Local only — not committed
    ├── team/         # Committed — shared across the team
    └── module/
        └── payments/ # Scoped to a specific module
```

The frontmatter schema:

| Field | Type | Description |
|---|---|---|
| `id` | string | Canonical ID: `YYYY-MM-DD-<type>-<slug>` |
| `scope` | enum | `personal` · `team` · `module` |
| `type` | enum | `convention` · `decision` · `gotcha` · `architecture` · `glossary` · `attempt` |
| `status` | enum | `draft` · `proposed` · `validated` · `stale` · `rejected` · `deprecated` |
| `anchor.paths` | string[] | File paths this memory is anchored to (staleness detection) |
| `anchor.symbols` | string[] | Symbol names this memory is anchored to |
| `anchor.commit` | string? | Git commit SHA at time of creation |
| `tags` | string[] | Free-form tags |
| `domain` | string? | Business domain (e.g. `payments`) |
| `related_ids` | string[] | IDs of related memories (auto-expanded in `get_briefing`) |
| `created_at` | ISO date | Creation timestamp |
| `verified_at` | ISO date? | Last anchor verification timestamp |
| `stale_reason` | string? | Why the memory was marked stale |
| `expires_when` | string? | Condition under which this memory should be deprecated |

---

## License

MIT
