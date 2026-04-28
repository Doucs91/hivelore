import { z } from "zod";

export const MemoryScopeSchema = z.enum(["personal", "team", "module"]);

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
  "attempt", // failed approach / negative knowledge — "tried X, failed because Y, use Z instead"
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
  })
  .refine(
    (data) => data.scope !== "module" || !!data.module,
    { message: "module name is required when scope is 'module'", path: ["module"] },
  );
