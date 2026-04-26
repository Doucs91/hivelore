import { Command } from "commander";
import { registerEmbeddings } from "./commands/embeddings.js";
import { registerInit } from "./commands/init.js";
import { registerMcp } from "./commands/mcp.js";
import { registerMemoryAdd } from "./commands/memory-add.js";
import { registerMemoryList } from "./commands/memory-list.js";
import { registerMemoryPromote } from "./commands/memory-promote.js";
import { registerMemoryQuery } from "./commands/memory-query.js";
import { registerMemoryVerify } from "./commands/memory-verify.js";

const program = new Command();

program
  .name("haive")
  .description("hAIve — team-first persistent memory layer for AI coding agents")
  .version("0.1.0");

registerInit(program);
registerMcp(program);
registerEmbeddings(program);

const memory = program.command("memory").description("Manage memory entries");
registerMemoryAdd(memory);
registerMemoryList(memory);
registerMemoryQuery(memory);
registerMemoryPromote(memory);
registerMemoryVerify(memory);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
