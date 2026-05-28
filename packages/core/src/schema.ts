import { z } from "zod";

export const MemoryScopeSchema = z.enum(["personal", "team", "module", "shared"]);

export const MemoryStatusSchema = z.enum([
  "draft",
  "proposed",
  "validated",
  "deprecated",
  "stale",
  "rejected",
]);

export const MemoryTypeSchema = z.enum([
  "convention",
  "decision",
  "gotcha",
  "architecture",
  "glossary",
  "skill",         // reusable procedure/playbook for a recurring task (feedforward harness guide)
  "attempt",       // failed approach — "tried X, failed because Y, use Z instead"
  "session_recap", // end-of-session summary: goal / accomplished / discoveries / next steps
]);

export const AnchorSchema = z.object({
  commit: z.string().optional(),
  paths: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
});

const IsoDateString = z
  .union([z.string(), z.date()])
  .transform((v) => (v instanceof Date ? v.toISOString() : v))
  .pipe(z.string().datetime());

export const MemoryFrontmatterSchema = z
  .object({
    id: z.string().min(1),
    scope: MemoryScopeSchema.default("personal"),
    module: z.string().optional(),
    type: MemoryTypeSchema,
    status: MemoryStatusSchema.default("draft"),
    anchor: AnchorSchema.default({ paths: [], symbols: [] }),
    tags: z.array(z.string()).default([]),
    domain: z.string().optional(),
    author: z.string().optional(),
    created_at: IsoDateString,
    expires_when: z.string().nullable().default(null),
    verified_at: z.string().nullable().default(null),
    stale_reason: z.string().nullable().default(null),
    related_ids: z.array(z.string()).default([]),
    last_read_at: z.string().nullable().default(null),
    topic: z.string().optional(),          // stable key for upsert — same topic in same scope → update instead of create
    revision_count: z.number().int().min(0).default(0), // incremented each time a topic upsert occurs
    /**
     * When true, the AI MUST NOT act on this memory autonomously.
     * It must surface the information to the human developer and wait
     * for explicit confirmation before modifying any code.
     * Used for cross-repo breaking changes, dependency bumps, contract diffs.
     */
    requires_human_approval: z.boolean().default(false),
  })
  .refine(
    (data) => data.scope !== "module" || !!data.module,
    { message: "module name is required when scope is 'module'", path: ["module"] },
  );

// Additional fields for cross-repo provenance (stored in frontmatter of imported memories)
export const CrossRepoProvenanceSchema = z.object({
  source_name: z.string(),    // the crossRepoSources name from haive.config.json
  source_path: z.string(),    // original file path in the source repo
  source_id: z.string(),      // original memory id
  imported_at: z.string(),    // ISO timestamp of import
}).optional();
