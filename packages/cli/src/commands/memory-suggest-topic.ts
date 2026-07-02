import { Command } from "commander";
import { MemoryTypeSchema, suggestTopicKey } from "@hivelore/core";
import { ui } from "../utils/ui.js";

export function registerMemorySuggestTopic(memory: Command): void {
  memory
    .command("suggest-topic")
    .description("Suggest a stable topic key (topic-upsert) from type + title phrase")
    .requiredOption(
      "--type <type>",
      "convention | decision | gotcha | architecture | glossary | attempt | session_recap",
    )
    .argument("<title>", "Short title or phrase to slugify")
    .action((title: string, opts: { type: string }) => {
      const parsed = MemoryTypeSchema.safeParse(opts.type);
      if (!parsed.success) {
        ui.error(`Invalid type: ${opts.type}`);
        process.exit(1);
      }
      const suggestion = suggestTopicKey(parsed.data, title);
      console.log(JSON.stringify({ type: parsed.data, ...suggestion }, null, 2));
    });
}
