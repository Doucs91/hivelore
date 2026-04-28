import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createContext, type CreateContextOptions, type HaiveContext } from "./context.js";
import {
  BootstrapProjectSaveInputSchema,
  bootstrapProjectSave,
  type BootstrapProjectSaveInput,
} from "./tools/bootstrap-project-save.js";
import {
  GetProjectContextInputSchema,
  getProjectContext,
  type GetProjectContextInput,
} from "./tools/get-project-context.js";
import { MemListInputSchema, memList, type MemListInput } from "./tools/mem-list.js";
import { MemSaveInputSchema, memSave, type MemSaveInput } from "./tools/mem-save.js";
import {
  MemSearchInputSchema,
  memSearch,
  type MemSearchInput,
} from "./tools/mem-search.js";
import {
  MemVerifyInputSchema,
  memVerify,
  type MemVerifyInput,
} from "./tools/mem-verify.js";
import {
  MemRejectInputSchema,
  memReject,
  type MemRejectInput,
} from "./tools/mem-reject.js";
import {
  MemForFilesInputSchema,
  memForFiles,
  type MemForFilesInput,
} from "./tools/mem-for-files.js";
import { MemGetInputSchema, memGet, type MemGetInput } from "./tools/mem-get.js";
import {
  MemDeleteInputSchema,
  memDelete,
  type MemDeleteInput,
} from "./tools/mem-delete.js";
import {
  MemUpdateInputSchema,
  memUpdate,
  type MemUpdateInput,
} from "./tools/mem-update.js";
import {
  MemPendingInputSchema,
  memPending,
  type MemPendingInput,
} from "./tools/mem-pending.js";
import {
  MemApproveInputSchema,
  memApprove,
  type MemApproveInput,
} from "./tools/mem-approve.js";
import {
  MemTriedInputSchema,
  memTried,
  type MemTriedInput,
} from "./tools/mem-tried.js";
import {
  GetBriefingInputSchema,
  getBriefing,
  type GetBriefingInput,
} from "./tools/get-briefing.js";
import {
  CodeMapInputSchema,
  codeMapTool,
  type CodeMapInput,
} from "./tools/code-map.js";
import {
  BootstrapProjectArgsSchema,
  bootstrapProjectPrompt,
  type BootstrapProjectArgs,
} from "./prompts/bootstrap-project.js";
import {
  PostTaskArgsSchema,
  postTaskPrompt,
  type PostTaskArgs,
} from "./prompts/post-task.js";

declare const __HAIVE_VERSION__: string;

export const SERVER_NAME = "haive";
export const SERVER_VERSION = __HAIVE_VERSION__;

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
  };
}

export function createHaiveServer(
  options: CreateContextOptions = {},
): { server: McpServer; context: HaiveContext } {
  const context = createContext(options);
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, prompts: {} } },
  );

  server.tool(
    "mem_save",
    "Save a new memory (convention, decision, gotcha, architecture, glossary). For failed approaches use mem_tried instead — it enforces a structured format that is more useful to future agents. Use scope=team to share with the whole team.",
    MemSaveInputSchema,
    async (input: MemSaveInput) => jsonResult(await memSave(input, context)),
  );

  server.tool(
    "mem_search",
    "Search memories by substring across id, tags, and body. Optional filters by scope/type/module.",
    MemSearchInputSchema,
    async (input: MemSearchInput) => jsonResult(await memSearch(input, context)),
  );

  server.tool(
    "mem_list",
    "List memories with optional filters by scope/type/module/tag.",
    MemListInputSchema,
    async (input: MemListInput) => jsonResult(await memList(input, context)),
  );

  server.tool(
    "get_project_context",
    "Read the shared .ai/project-context.md (and optionally a module context).",
    GetProjectContextInputSchema,
    async (input: GetProjectContextInput) =>
      jsonResult(await getProjectContext(input, context)),
  );

  server.tool(
    "get_briefing",
    "One-shot onboarding: returns project context + module contexts + ranked relevant memories under a token budget. Replaces 4–5 separate calls when an agent starts a task.",
    GetBriefingInputSchema,
    async (input: GetBriefingInput) => jsonResult(await getBriefing(input, context)),
  );

  server.tool(
    "code_map",
    "Browse the project's pre-computed code map (file → exports + 1-line description) instead of grepping. Requires `haive index code`.",
    CodeMapInputSchema,
    async (input: CodeMapInput) => jsonResult(await codeMapTool(input, context)),
  );

  server.tool(
    "bootstrap_project_save",
    "Persist a project (or module) context document analyzed by the AI client.",
    BootstrapProjectSaveInputSchema,
    async (input: BootstrapProjectSaveInput) =>
      jsonResult(await bootstrapProjectSave(input, context)),
  );

  server.tool(
    "mem_verify",
    "Check anchor freshness for one or every memory; optionally write status updates back to disk.",
    MemVerifyInputSchema,
    async (input: MemVerifyInput) => jsonResult(await memVerify(input, context)),
  );

  server.tool(
    "mem_reject",
    "Record a rejection for a memory (blocks auto-promotion and lowers its trust signal).",
    MemRejectInputSchema,
    async (input: MemRejectInput) => jsonResult(await memReject(input, context)),
  );

  server.tool(
    "mem_for_files",
    "Given the file paths the agent is currently working on, return relevant memories grouped by reason (anchor overlap, module, domain) plus any matching .ai/modules/<name>/context.md contents.",
    MemForFilesInputSchema,
    async (input: MemForFilesInput) => jsonResult(await memForFiles(input, context)),
  );

  server.tool(
    "mem_get",
    "Fetch a single memory by id, including its body, anchor, usage, and confidence.",
    MemGetInputSchema,
    async (input: MemGetInput) => jsonResult(await memGet(input, context)),
  );

  server.tool(
    "mem_delete",
    "Delete a memory by id (and its usage entry by default).",
    MemDeleteInputSchema,
    async (input: MemDeleteInput) => jsonResult(await memDelete(input, context)),
  );

  server.tool(
    "mem_update",
    "Update the body, tags, or anchor of an existing memory without changing its id or losing usage history.",
    MemUpdateInputSchema,
    async (input: MemUpdateInput) => jsonResult(await memUpdate(input, context)),
  );

  server.tool(
    "mem_pending",
    "List 'proposed' memories awaiting review, sorted by reads (most-read first).",
    MemPendingInputSchema,
    async (input: MemPendingInput) => jsonResult(await memPending(input, context)),
  );

  server.tool(
    "mem_approve",
    "Mark a memory as validated immediately (explicit team review).",
    MemApproveInputSchema,
    async (input: MemApproveInput) => jsonResult(await memApprove(input, context)),
  );

  server.tool(
    "mem_tried",
    "Preferred way to record a failed approach. Enforces a structured what/why_failed/instead format that is immediately actionable for future agents. Auto-validated (no approval cycle). Use whenever you tried an approach and it failed — prevents the same mistake from happening in the next session.",
    MemTriedInputSchema,
    async (input: MemTriedInput) => jsonResult(await memTried(input, context)),
  );

  server.prompt(
    "bootstrap_project",
    "Instructions for the AI client to analyze the project and save the context.",
    BootstrapProjectArgsSchema,
    (args: BootstrapProjectArgs) => bootstrapProjectPrompt(args, context),
  );

  server.prompt(
    "post_task",
    "Post-task checklist: run this after completing a task to capture failed approaches, new conventions, decisions, and gotchas before closing the session.",
    PostTaskArgsSchema,
    (args: PostTaskArgs) => postTaskPrompt(args, context),
  );

  return { server, context };
}
