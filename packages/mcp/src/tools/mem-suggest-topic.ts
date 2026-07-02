import { MemoryTypeSchema, suggestTopicKey } from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemSuggestTopicInputSchema = {
  type: MemoryTypeSchema.describe("Memory kind — drives the suggested topic family."),
  title: z
    .string()
    .min(1)
    .describe("Short title or phrase (headers, headings) — turned into slug"),
};

export type MemSuggestTopicInput = {
  [K in keyof typeof MemSuggestTopicInputSchema]: z.infer<(typeof MemSuggestTopicInputSchema)[K]>;
};

export async function memSuggestTopic(
  input: MemSuggestTopicInput,
  _ctx: HaiveContext,
): Promise<{ topic_key: string; family: string; type: string }> {
  void _ctx;
  const suggestion = suggestTopicKey(input.type, input.title);
  return { topic_key: suggestion.topic_key, family: suggestion.family, type: input.type };
}
