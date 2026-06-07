import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  buildFrontmatter,
  memoryFilePath,
  serializeMemory,
  suggestSensorFromMemory,
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
  /** True when a regex sensor was auto-generated → the loop can close (gate will block the repeat). */
  sensor_generated: boolean;
  /** Next-step guidance: how to close the loop, or how to upgrade the warn sensor into a reliable block. */
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
  const sensor = suggestSensorFromMemory(body, input.paths);
  if (sensor) {
    frontmatter.sensor = sensor;
  }

  const file = memoryFilePath(ctx.paths, frontmatter.scope, frontmatter.id, frontmatter.module);
  await mkdir(path.dirname(file), { recursive: true });

  if (existsSync(file)) {
    throw new Error(`Memory already exists at ${file}`);
  }

  await writeFile(file, serializeMemory({ frontmatter, body }), "utf8");

  // Ratchet visibility: a captured lesson only CLOSES the loop (gate blocks the repeat) if it carries
  // a sensor. suggestSensorFromMemory returns null when no anchor `paths` were given, or no distinctive
  // token was found. Surface that explicitly so the agent knows the lesson is advisory-only, not enforced.
  const sensorGenerated = Boolean(sensor);
  const hint = sensorGenerated
    ? "A heuristic warn sensor was auto-suggested. For a RELIABLE block, call propose_sensor with a discriminating pattern (pattern = the faulty usage, absent = the correct-usage marker) — you understand the code; hAIve validates the proposal (silent on current code, fires on the bad example) before trusting it to block."
    : input.paths.length === 0
      ? "No sensor was generated (no `paths` given), so this lesson is feedforward-only — it will be briefed but the gate cannot block the repeat. Re-run with `paths` set to the file(s) where the mistake lives, then call propose_sensor to close the loop."
      : "No sensor could be derived from the wording. Call propose_sensor with a discriminating pattern (pattern = faulty usage, absent = correct-usage marker) to make the gate block the repeat.";

  return {
    id: frontmatter.id,
    scope: frontmatter.scope,
    file_path: file,
    sensor_generated: sensorGenerated,
    ...(hint ? { hint } : {}),
  };
}
