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
import {
  BootstrapProjectArgsSchema,
  bootstrapProjectPrompt,
  type BootstrapProjectArgs,
} from "./prompts/bootstrap-project.js";

export const SERVER_NAME = "haive";
export const SERVER_VERSION = "0.1.0";

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
    "Save a new memory (default scope=personal). Use scope=team for shared memories.",
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

  server.prompt(
    "bootstrap_project",
    "Instructions for the AI client to analyze the project and save the context.",
    BootstrapProjectArgsSchema,
    (args: BootstrapProjectArgs) => bootstrapProjectPrompt(args, context),
  );

  return { server, context };
}
