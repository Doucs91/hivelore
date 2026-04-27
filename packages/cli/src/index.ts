import { Command } from "commander";
import { registerEmbeddings } from "./commands/embeddings.js";
import { registerIndexCode } from "./commands/index-code.js";
import { registerInit } from "./commands/init.js";
import { registerInstallHooks } from "./commands/install-hooks.js";
import { registerMcp } from "./commands/mcp.js";
import { registerSync } from "./commands/sync.js";
import { registerMemoryAdd } from "./commands/memory-add.js";
import { registerMemoryList } from "./commands/memory-list.js";
import { registerMemoryPromote } from "./commands/memory-promote.js";
import { registerMemoryApprove } from "./commands/memory-approve.js";
import { registerMemoryAutoPromote } from "./commands/memory-auto-promote.js";
import { registerMemoryEdit } from "./commands/memory-edit.js";
import { registerMemoryForFiles } from "./commands/memory-for-files.js";
import { registerMemoryHot } from "./commands/memory-hot.js";
import { registerMemoryPending } from "./commands/memory-pending.js";
import { registerMemoryQuery } from "./commands/memory-query.js";
import { registerMemoryReject } from "./commands/memory-reject.js";
import { registerMemoryRm } from "./commands/memory-rm.js";
import { registerMemoryShow } from "./commands/memory-show.js";
import { registerMemoryStats } from "./commands/memory-stats.js";
import { registerMemoryVerify } from "./commands/memory-verify.js";

const program = new Command();

declare const __HAIVE_VERSION__: string;

program
  .name("haive")
  .description("hAIve — team-first persistent memory layer for AI coding agents")
  .version(__HAIVE_VERSION__);

registerInit(program);
registerMcp(program);
registerEmbeddings(program);
registerSync(program);
registerInstallHooks(program);
registerIndexCode(program);

const memory = program.command("memory").description("Manage memory entries");
registerMemoryAdd(memory);
registerMemoryList(memory);
registerMemoryQuery(memory);
registerMemoryPromote(memory);
registerMemoryVerify(memory);
registerMemoryStats(memory);
registerMemoryReject(memory);
registerMemoryAutoPromote(memory);
registerMemoryForFiles(memory);
registerMemoryShow(memory);
registerMemoryEdit(memory);
registerMemoryRm(memory);
registerMemoryPending(memory);
registerMemoryApprove(memory);
registerMemoryHot(memory);

program.parseAsync(process.argv).catch((err: unknown) => {
  if (isZodError(err)) {
    for (const issue of err.issues) {
      const field = issue.path.length > 0 ? `${String(issue.path.join("."))}: ` : "";
      console.error(`\x1b[31m✗\x1b[0m ${field}${issue.message}`);
    }
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exit(1);
});

function isZodError(
  err: unknown,
): err is { issues: Array<{ path: unknown[]; message: string }> } {
  return (
    err !== null &&
    typeof err === "object" &&
    "issues" in err &&
    Array.isArray((err as Record<string, unknown>).issues)
  );
}
