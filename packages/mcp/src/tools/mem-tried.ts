import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildFrontmatter,
  memoryFilePath,
  serializeMemory,
  suggestSensorSeed,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemTriedInputSchema = {
  what: z.string().min(1).describe("Brief description of the approach that was tried"),
  why_failed: z
    .string()
    .min(1)
    .describe("Why it failed or why it should NOT be used"),
  instead: z
    .string()
    .optional()
    .describe("What to use or do instead (recommended alternative)"),
  scope: z
    .enum(["personal", "team", "module"])
    .default("personal")
    .describe("Visibility scope"),
  module: z.string().optional().describe("Module name (required when scope=module)"),
  tags: z.array(z.string()).default([]).describe("Tags for filtering"),
  paths: z
    .array(z.string())
    .default([])
    .describe("Anchor file paths this applies to"),
  author: z.string().optional().describe("Author handle or email"),
};

export type MemTriedInput = {
  [K in keyof typeof MemTriedInputSchema]: z.infer<(typeof MemTriedInputSchema)[K]>;
};

export interface MemTriedOutput {
  id: string;
  scope: string;
  file_path: string;
  /**
   * A captured attempt closes its prevention loop (gate can block the repeat) only once a sensor is
   * VALIDATED via propose_sensor. True until then — the lesson is briefed but not enforced.
   */
  loop_open: boolean;
  /** Heuristic candidate to PRE-FILL a propose_sensor call (refine, then call it). Never a persisted sensor. */
  proposed_sensor_seed?: { pattern: string; absent?: string; message: string };
  /** Next-step guidance: how to close the loop via propose_sensor. */
  hint?: string;
}

export async function memTried(
  input: MemTriedInput,
  ctx: HaiveContext,
): Promise<MemTriedOutput> {
  if (!existsSync(ctx.paths.haiveDir)) {
    throw new Error(`No .ai/ directory at ${ctx.paths.root}. Run 'haive init' first.`);
  }

  const slug = input.what
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5)
    .join("-");

  const baseFm = buildFrontmatter({
    type: "attempt",
    slug,
    scope: input.scope,
    module: input.module,
    tags: input.tags,
    paths: input.paths,
    author: input.author,
  });
  // attempt memories are immediately validated — no review cycle needed
  const frontmatter = { ...baseFm, status: "validated" as const };

  const lines: string[] = [`# ${input.what}`, ""];
  lines.push(`**Why it failed / do NOT use:** ${input.why_failed}`);
  if (input.instead) {
    lines.push("", `**Instead, use:** ${input.instead}`);
  }
  const body = lines.join("\n") + "\n";

  const file = memoryFilePath(ctx.paths, frontmatter.scope, frontmatter.id, frontmatter.module);
  await mkdir(path.dirname(file), { recursive: true });

  if (existsSync(file)) {
    throw new Error(`Memory already exists at ${file}`);
  }

  await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");

  // A captured attempt only CLOSES the loop (gate blocks the repeat) once a sensor is VALIDATED via
  // propose_sensor. We no longer auto-write a heuristic warn sensor; instead we hand the agent a SEED
  // (when one can be derived) to pre-fill propose_sensor, and tell it the loop is open until then.
  const seed = input.paths.length > 0 ? suggestSensorSeed(body, input.paths) : null;
  const hint =
    input.paths.length === 0
      ? "No `paths` given, so this attempt is feedforward-only — it will be briefed but the gate cannot block the repeat. Re-run with `paths` set to the file(s) where the mistake lives, then call propose_sensor to close the loop."
      : seed
        ? "This attempt is NOT yet enforced. Call propose_sensor to turn it into a reliable block — a candidate is pre-filled in proposed_sensor_seed (refine it: pattern = the faulty usage, absent = the correct-usage marker). hAIve validates the proposal (silent on current code, fires on the bad example) before trusting it to block."
        : "This attempt is NOT yet enforced and no candidate pattern could be derived from the wording. Call propose_sensor with a discriminating pattern (pattern = faulty usage, absent = correct-usage marker) to close the loop.";

  return {
    id: frontmatter.id,
    scope: frontmatter.scope,
    file_path: file,
    loop_open: true,
    ...(seed
      ? {
          proposed_sensor_seed: {
            pattern: seed.pattern,
            ...(seed.absent ? { absent: seed.absent } : {}),
            message: seed.message,
          },
        }
      : {}),
    hint,
  };
}
