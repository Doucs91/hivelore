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

/**
 * An executable check derived from a memory — the "feedback computational" layer.
 *
 * A `gotcha`/`attempt` is normally feedforward (text the agent reads). A sensor turns
 * that lesson into a deterministic check: when a touched file matches `pattern`, the
 * memory's warning fires regardless of semantic ranking. This closes the harness loop —
 * a documented mistake becomes a permanent guardrail.
 *
 * Phase 1 implements `kind: "regex"` only. `shell`/`test` are reserved for a later phase
 * (they require I/O and must run from the CLI, not core).
 */
export const SensorSchema = z.object({
  kind: z.enum(["regex", "shell", "test"]).default("regex"),
  /** Regex source (for kind=regex), matched against added diff lines / file content. */
  pattern: z.string().optional(),
  /** Regex flags (e.g. "i", "m"). Ignored for non-regex kinds. */
  flags: z.string().optional(),
  /** Shell/test command to run (for kind=shell|test). Executed by the CLI, never by core. */
  command: z.string().optional(),
  /** Glob-ish path prefixes the sensor applies to. Falls back to the memory's anchor paths when empty. */
  paths: z.array(z.string()).default([]),
  /** LLM-facing self-correction message: what was done wrong and what to do instead. */
  message: z.string().min(1),
  /** `warn` surfaces in review; `block` can hard-block the commit (only when the gate opts in). */
  severity: z.enum(["warn", "block"]).default("warn"),
  /** True when hAIve generated this sensor automatically (vs. hand-authored). */
  autogen: z.boolean().default(false),
  /** ISO timestamp of the last time this sensor matched a diff. */
  last_fired: z.string().nullable().default(null),
});

/**
 * Progressive-disclosure activation triggers for a `skill` memory.
 *
 * A skill is a reusable playbook (feedforward harness guide). Injecting every skill
 * on every briefing bloats the context and dilutes signal (the "instruction budget"
 * problem). An `activation` block makes a skill surface ONLY when it is relevant:
 * its keywords match the task, or its globs match the files being edited. A skill
 * that defines `activation` and matches none of it is suppressed from the briefing;
 * a skill with no `activation` block keeps the legacy always-eligible behavior.
 */
export const ActivationSchema = z.object({
  /** Case-insensitive substrings matched against the task text. */
  keywords: z.array(z.string()).default([]),
  /** Glob-ish path patterns matched against the files being edited. */
  globs: z.array(z.string()).default([]),
  /** Always activate (rare — for truly universal playbooks). */
  always: z.boolean().default(false),
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
    /** Optional executable check derived from this memory (feedback computational layer). */
    sensor: SensorSchema.optional(),
    /** Optional progressive-disclosure triggers — only meaningful for `type: skill`. */
    activation: ActivationSchema.optional(),
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
