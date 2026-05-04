import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
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
  MemObserveInputSchema,
  memObserve,
  type MemObserveInput,
} from "./tools/mem-observe.js";
import {
  MemSessionEndInputSchema,
  memSessionEnd,
  type MemSessionEndInput,
} from "./tools/mem-session-end.js";
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
  MemDiffInputSchema,
  memDiff,
  type MemDiffInput,
} from "./tools/mem-diff.js";
import {
  GetRecapInputSchema,
  getRecap,
  type GetRecapInput,
} from "./tools/get-recap.js";
import {
  MemRelevantToInputSchema,
  memRelevantTo,
  type MemRelevantToInput,
} from "./tools/mem-relevant-to.js";
import {
  CodeSearchInputSchema,
  codeSearch,
  type CodeSearchInput,
} from "./tools/code-search.js";
import {
  WhyThisFileInputSchema,
  whyThisFile,
  type WhyThisFileInput,
} from "./tools/why-this-file.js";
import {
  AntiPatternsCheckInputSchema,
  antiPatternsCheck,
  type AntiPatternsCheckInput,
} from "./tools/anti-patterns-check.js";
import {
  MemDistillInputSchema,
  memDistill,
  type MemDistillInput,
} from "./tools/mem-distill.js";
import {
  WhyThisDecisionInputSchema,
  whyThisDecision,
  type WhyThisDecisionInput,
} from "./tools/why-this-decision.js";
import {
  MemConflictsInputSchema,
  memConflicts,
  type MemConflictsInput,
} from "./tools/mem-conflicts.js";
import {
  PreCommitCheckInputSchema,
  preCommitCheck,
  type PreCommitCheckInput,
} from "./tools/precommit-check.js";
import {
  PatternDetectInputSchema,
  patternDetect,
  type PatternDetectInput,
} from "./tools/pattern-detect.js";
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
import {
  ImportDocsArgsSchema,
  importDocsPrompt,
  type ImportDocsArgs,
} from "./prompts/import-docs.js";
import { SessionTracker } from "./session-tracker.js";

// Re-export tool implementations so `@hiveai/cli` (and integrators) can call
// them programmatically without going through the MCP stdio transport.
// These are the same handlers the MCP server registers below.
export {
  getBriefing,
  type GetBriefingInput,
  type BriefingOutput,
} from "./tools/get-briefing.js";
export {
  codeMapTool,
  type CodeMapInput,
  type CodeMapToolOutput,
} from "./tools/code-map.js";
export {
  getRecap,
  type GetRecapInput,
  type GetRecapOutput,
} from "./tools/get-recap.js";
export {
  memRelevantTo,
  type MemRelevantToInput,
  type MemRelevantToOutput,
} from "./tools/mem-relevant-to.js";
export {
  codeSearch,
  type CodeSearchInput,
  type CodeSearchOutput,
} from "./tools/code-search.js";
export {
  whyThisFile,
  type WhyThisFileInput,
  type WhyThisFileOutput,
} from "./tools/why-this-file.js";
export {
  antiPatternsCheck,
  type AntiPatternsCheckInput,
  type AntiPatternsCheckOutput,
} from "./tools/anti-patterns-check.js";
export {
  memDistill,
  type MemDistillInput,
  type MemDistillOutput,
} from "./tools/mem-distill.js";
export {
  whyThisDecision,
  type WhyThisDecisionInput,
  type WhyThisDecisionOutput,
} from "./tools/why-this-decision.js";
export {
  memConflicts,
  type MemConflictsInput,
  type MemConflictsOutput,
} from "./tools/mem-conflicts.js";
export {
  preCommitCheck,
  type PreCommitCheckInput,
  type PreCommitCheckOutput,
} from "./tools/precommit-check.js";
export {
  patternDetect,
  type PatternDetectInput,
  type PatternDetectOutput,
} from "./tools/pattern-detect.js";

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
): { server: McpServer; context: HaiveContext; tracker: SessionTracker } {
  const context = createContext(options);
  const tracker = new SessionTracker(context);
  // Init is async — fire-and-forget at startup (registers shutdown handler if autopilot)
  void tracker.init();

  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, prompts: {} } },
  );

  // ── Memory creation ────────────────────────────────────────────────────

  server.tool(
    "mem_save",
    [
      "Save a piece of knowledge as a persistent memory that survives across AI sessions.",
      "",
      "USE THIS WHEN you discover something worth remembering for future sessions:",
      "  - A project convention (how things are done here)",
      "  - An architectural decision and its rationale",
      "  - A gotcha or non-obvious behavior that surprised you",
      "  - A domain term and what it means in this codebase",
      "",
      "DO NOT USE for failed approaches → use mem_tried instead (better structure).",
      "DO NOT USE for code discoveries during exploration → use mem_observe instead.",
      "",
      "PARAMETERS:",
      "  type     — convention | decision | gotcha | architecture | glossary | attempt",
      "  slug     — short kebab-case id (e.g. 'flyway-no-modify-existing')",
      "  body     — Markdown content with the full knowledge",
      "  scope    — team (shared with all devs) | personal (private) | module (component-scoped)",
      "  paths    — anchor to source files for staleness detection (STRONGLY recommended)",
      "  topic    — stable key for upsert: if a memory with same topic+scope exists, update it in-place",
      "",
      "RETURNS: { id, scope, file_path, action: 'created'|'updated', warning?, invalid_paths? }",
      "WARNING: if paths point to non-existent files, they will be immediately stale after haive sync.",
      "DEDUP: identical body content within the same scope is rejected — use mem_update to modify.",
    ].join("\n"),
    MemSaveInputSchema,
    async (input: MemSaveInput) => {
      tracker.record("mem_save", input.slug);
      return jsonResult(await memSave(input, context));
    },
  );

  server.tool(
    "mem_tried",
    [
      "Record a FAILED approach so future agents don't repeat the same mistake.",
      "",
      "USE THIS IMMEDIATELY when you try something and it doesn't work. This is the",
      "most valuable type of negative knowledge — it saves hours of debugging for",
      "future agents working on the same codebase.",
      "",
      "Auto-validated (no approval cycle). Surfaced FIRST in future get_briefing calls",
      "so it's impossible to miss.",
      "",
      "PARAMETERS:",
      "  what       — short title of what you tried (e.g. 'importing X with ESM dynamic import')",
      "  why_failed — the exact error or reason it failed",
      "  instead    — what to do instead (the correct approach)",
      "  scope      — team (default) | personal",
      "  paths      — source files where the issue lives",
      "",
      "RETURNS: { id, file_path, action: 'created' }",
    ].join("\n"),
    MemTriedInputSchema,
    async (input: MemTriedInput) => {
      tracker.record("mem_tried", input.what.slice(0, 80));
      return jsonResult(await memTried(input, context));
    },
  );

  server.tool(
    "mem_observe",
    [
      "Capture a code-level discovery made WHILE READING existing code.",
      "",
      "USE THIS when you read a file and spot something the team may not know about:",
      "  - A bug or race condition hiding in the code",
      "  - A security gap or missing validation",
      "  - An inconsistency between two files",
      "  - A missing configuration or environment variable",
      "  - Anything that could silently break in production",
      "",
      "DIFFERENCE from mem_save: mem_observe is for REACTIVE discoveries during code",
      "reading. mem_save is for deliberate knowledge capture (conventions, decisions).",
      "",
      "Auto-validated, anchored to file paths for staleness detection.",
      "",
      "PARAMETERS:",
      "  what   — one-line title (e.g. 'MobilePaymentController: duplicate @RequestBody')",
      "  where  — file path(s) where the issue lives",
      "  impact — what breaks or could break because of this",
      "  fix    — suggested fix (optional)",
      "  scope  — team (default, since discoveries benefit everyone)",
      "",
      "RETURNS: { id, file_path }",
    ].join("\n"),
    MemObserveInputSchema,
    async (input: MemObserveInput) => {
      tracker.record("mem_observe", input.where);
      return jsonResult(await memObserve(input, context));
    },
  );

  server.tool(
    "mem_session_end",
    [
      "Save an end-of-session recap so the NEXT session starts with fresh context.",
      "",
      "CALL THIS before closing any significant working session. In autopilot mode,",
      "the MCP server saves a minimal recap automatically on exit — but calling this",
      "manually produces a richer, more useful recap.",
      "",
      "HOW IT WORKS: uses topic-upsert — one recap per scope is kept and updated",
      "in-place (revision_count increments). get_briefing surfaces the latest recap",
      "at the very top of the next session's briefing, before project context.",
      "",
      "PARAMETERS:",
      "  goal         — what you were trying to accomplish (1–2 sentences)",
      "  accomplished — what was actually done (bullet list recommended)",
      "  discoveries  — bugs, surprises, missing knowledge found during this session",
      "  files_touched — key files read or modified (used as anchor for staleness)",
      "  next_steps   — what should happen in the next session or for a teammate",
      "  scope        — personal (default) | team",
      "",
      "RETURNS: { id, scope, action: 'created'|'updated', revision_count }",
    ].join("\n"),
    MemSessionEndInputSchema,
    async (input: MemSessionEndInput) => {
      tracker.record("mem_session_end", input.goal.slice(0, 80));
      return jsonResult(await memSessionEnd(input, context));
    },
  );

  // ── Memory retrieval ───────────────────────────────────────────────────

  server.tool(
    "get_briefing",
    [
      "⭐ CALL THIS FIRST at the start of every task. One-shot onboarding that returns",
      "everything relevant in a single call under a token budget.",
      "",
      "RETURNS (in order of priority):",
      "  0. action_required — ⚠️ HANDLE THIS FIRST if non-empty (see protocol below)",
      "  1. last_session   — recap of the previous session (goal, what was done, next steps)",
      "  2. project_context — .ai/project-context.md (auto-generated from code-map if template)",
      "  3. module_contexts — relevant .ai/modules/<name>/context.md based on files being edited",
      "  4. memories        — ranked team memories relevant to your task",
      "  5. symbol_locations — file:line:kind for any requested symbols (no grep needed)",
      "  6. setup_warnings  — actionable warnings if setup is incomplete",
      "  7. decay_warnings  — memories not read in >90 days (consider reviewing)",
      "",
      "⚠️ ACTION_REQUIRED PROTOCOL — MANDATORY:",
      "  If action_required[] is non-empty, STOP and for each item:",
      "  1. Show the developer the exact developer_message field verbatim",
      "  2. Wait for explicit human confirmation ('yes', 'go ahead', 'oui', etc.)",
      "  3. Only then proceed with any code changes",
      "  NEVER act autonomously on cross-repo breaking changes, dep bumps, or contract diffs.",
      "",
      "KEY PARAMETERS:",
      "  task    — what you are about to do (1–2 sentences) — ALWAYS provide this",
      "  files   — files you are about to edit — surfaces anchored memories",
      "  symbols — symbol names to look up in the code-map (e.g. ['PaymentService'])",
      "  format  — 'full' (default) | 'compact' (1-line summaries, use when token budget is tight)",
      "",
      "EXAMPLE USAGE:",
      "  get_briefing({ task: 'add a Stripe payment integration', files: ['src/payments/'], symbols: ['PaymentService'] })",
      "",
      "CONFIDENCE LEVELS in memories:",
      "  authoritative — validated + read 10+ times (highest trust)",
      "  trusted       — validated or proposed + read 3+ times",
      "  low           — proposed, few reads (take with caution)",
      "  unverified    — draft (unverified: true flag set)",
      "",
      "Replaces 4–5 separate tool calls. Always call this before any other tool.",
    ].join("\n"),
    GetBriefingInputSchema,
    async (input: GetBriefingInput) => {
      tracker.record("get_briefing", input.task ?? "");
      return jsonResult(await getBriefing(input, context));
    },
  );

  server.tool(
    "mem_search",
    [
      "Search memories by keyword or semantic similarity.",
      "",
      "USE WHEN you need to find a specific memory and don't know its id.",
      "For session onboarding, use get_briefing instead (richer, ranked, budgeted).",
      "",
      "SEARCH MODES:",
      "  Literal (default): AND search across id, tags, and body — all tokens must match.",
      "  Falls back to OR automatically if no AND results (partial match).",
      "  Semantic (semantic: true): embedding-based similarity — finds related memories",
      "  even with different wording. Requires haive embeddings index to be built.",
      "",
      "PARAMETERS:",
      "  query    — search terms or natural language question",
      "  scope    — filter by personal | team | module",
      "  type     — filter by convention | decision | gotcha | architecture | glossary",
      "  semantic — true for embedding-based search (requires @hiveai/embeddings)",
      "  limit    — max results (default 10)",
      "",
      "RETURNS: array of { id, type, scope, status, confidence, body, match_quality }",
    ].join("\n"),
    MemSearchInputSchema,
    async (input: MemSearchInput) => {
      tracker.record("mem_search", input.query.slice(0, 80));
      return jsonResult(await memSearch(input, context));
    },
  );

  server.tool(
    "mem_for_files",
    [
      "Surface memories relevant to the files you are currently editing.",
      "",
      "USE WHEN starting work on specific files and you want to know:",
      "  - What conventions apply to these files",
      "  - What gotchas are anchored to these paths",
      "  - What decisions were made about this module",
      "",
      "Matching strategy (in priority order):",
      "  1. Anchor overlap — memories whose paths overlap with your files",
      "  2. Module context — .ai/modules/<name>/context.md if module is inferred",
      "  3. Domain/tag match — memories whose tags include path segments",
      "",
      "PARAMETERS:",
      "  files — list of project-relative file paths you are editing",
      "  scope — filter by scope (default: all)",
      "",
      "RETURNS: { memories: [...], module_contexts: [...] }",
    ].join("\n"),
    MemForFilesInputSchema,
    async (input: MemForFilesInput) => jsonResult(await memForFiles(input, context)),
  );

  server.tool(
    "mem_get",
    [
      "Fetch a single memory by its full id with all details.",
      "",
      "USE WHEN get_briefing returned a memory in 'compact' format and you need",
      "the full body, or when you know the exact id of a memory.",
      "",
      "PARAMETERS:",
      "  id — full memory id (e.g. '2026-04-28-gotcha-flyway-strict-no-ddl')",
      "",
      "RETURNS: { id, type, scope, status, confidence, body, anchor, tags, usage }",
    ].join("\n"),
    MemGetInputSchema,
    async (input: MemGetInput) => jsonResult(await memGet(input, context)),
  );

  server.tool(
    "mem_list",
    [
      "List memories with optional filters. Use for browsing, not for task onboarding.",
      "",
      "For task onboarding use get_briefing (ranked + budgeted).",
      "For keyword search use mem_search.",
      "",
      "PARAMETERS:",
      "  scope  — personal | team | module",
      "  type   — convention | decision | gotcha | architecture | glossary",
      "  status — draft | proposed | validated | stale | rejected",
      "  tags   — filter by tags (AND match)",
      "  module — filter by module name",
      "",
      "RETURNS: array of { id, type, scope, status, confidence, tags, created_at }",
    ].join("\n"),
    MemListInputSchema,
    async (input: MemListInput) => jsonResult(await memList(input, context)),
  );

  // ── Project context ────────────────────────────────────────────────────

  server.tool(
    "get_project_context",
    [
      "Read .ai/project-context.md (and optionally a module context) directly.",
      "",
      "USE WHEN you need the full project context without the memory ranking and",
      "token budgeting of get_briefing — e.g. for a reference architecture review.",
      "",
      "For normal task onboarding, use get_briefing instead (more efficient).",
      "",
      "PARAMETERS:",
      "  module — also load .ai/modules/<module>/context.md if provided",
      "",
      "RETURNS: { content: string, module_context?: string }",
    ].join("\n"),
    GetProjectContextInputSchema,
    async (input: GetProjectContextInput) =>
      jsonResult(await getProjectContext(input, context)),
  );

  server.tool(
    "bootstrap_project_save",
    [
      "Persist the project context document (.ai/project-context.md) or a module",
      "context (.ai/modules/<name>/context.md) analyzed by the AI.",
      "",
      "USE AFTER the bootstrap_project MCP prompt: the prompt tells you how to",
      "analyze the codebase; this tool saves the result.",
      "",
      "PARAMETERS:",
      "  content — full Markdown content of the context document",
      "  module  — if provided, saves as a module context (not root project context)",
      "",
      "RETURNS: { file_path, module? }",
    ].join("\n"),
    BootstrapProjectSaveInputSchema,
    async (input: BootstrapProjectSaveInput) =>
      jsonResult(await bootstrapProjectSave(input, context)),
  );

  server.tool(
    "code_map",
    [
      "Look up where symbols (classes, functions, interfaces) are defined in the codebase.",
      "",
      "USE INSTEAD OF grepping when you need to find where something lives.",
      "Requires haive index code to have been run (done automatically in autopilot mode).",
      "",
      "TIP: include symbols in get_briefing directly for auto-lookup at session start.",
      "",
      "PARAMETERS:",
      "  symbol   — name or partial name to search (e.g. 'PaymentService')",
      "  file     — filter by file path substring",
      "  max_files — cap on results (default 40)",
      "",
      "RETURNS: { available: bool, files: [{ path, exports: [{ name, kind, line, description }] }] }",
      "If available: false → run haive index code first.",
    ].join("\n"),
    CodeMapInputSchema,
    async (input: CodeMapInput) => jsonResult(await codeMapTool(input, context)),
  );

  // ── Memory lifecycle ───────────────────────────────────────────────────

  server.tool(
    "mem_update",
    [
      "Update the body, tags, or anchor of an existing memory in-place.",
      "",
      "USE WHEN a memory exists but its content has become outdated or incomplete.",
      "This preserves the memory's id, usage history, and read_count.",
      "",
      "For evolving memories that you will update repeatedly, use mem_save with a",
      "topic key instead (topic-upsert pattern).",
      "",
      "PARAMETERS:",
      "  id      — full memory id to update",
      "  body    — new Markdown content (replaces existing body)",
      "  tags    — new tag list (replaces existing tags)",
      "  paths   — new anchor paths (replaces existing paths)",
      "  symbols — new anchor symbols (replaces existing symbols)",
      "",
      "RETURNS: { id, file_path, updated_fields: string[] }",
    ].join("\n"),
    MemUpdateInputSchema,
    async (input: MemUpdateInput) => jsonResult(await memUpdate(input, context)),
  );

  server.tool(
    "mem_verify",
    [
      "Check whether memory anchor paths and symbols still exist in the current code.",
      "",
      "USE WHEN you want to know if a specific memory is still valid after a refactor,",
      "or to check all memories for staleness (haive sync does this automatically).",
      "",
      "PARAMETERS:",
      "  id     — check a single memory (omit to check all)",
      "  update — write 'stale' or 'validated' status back to disk",
      "",
      "RETURNS: { results: [{ id, status: 'fresh'|'stale'|'anchorless', reason? }] }",
      "Stale means the anchored file/symbol no longer exists at that path.",
      "Anchorless means the memory has no paths/symbols — staleness is undetectable.",
    ].join("\n"),
    MemVerifyInputSchema,
    async (input: MemVerifyInput) => jsonResult(await memVerify(input, context)),
  );

  server.tool(
    "mem_approve",
    [
      "Mark a memory as validated (trusted, approved by a human or the team).",
      "",
      "In autopilot mode, memories are validated automatically — you rarely need this.",
      "In manual mode, call this after reviewing a proposed memory to activate it.",
      "",
      "PARAMETERS:",
      "  id — full memory id to approve",
      "",
      "RETURNS: { id, previous_status, new_status: 'validated' }",
    ].join("\n"),
    MemApproveInputSchema,
    async (input: MemApproveInput) => jsonResult(await memApprove(input, context)),
  );

  server.tool(
    "mem_reject",
    [
      "Mark a memory as rejected and record a reason.",
      "",
      "USE WHEN a memory is factually wrong, outdated, or not useful.",
      "Rejection blocks auto-promotion and lowers the memory's trust signal.",
      "Rejected memories are excluded from get_briefing by default.",
      "",
      "PARAMETERS:",
      "  id     — full memory id to reject",
      "  reason — why this memory is being rejected (stored in frontmatter)",
      "",
      "RETURNS: { id, previous_status, new_status: 'rejected' }",
    ].join("\n"),
    MemRejectInputSchema,
    async (input: MemRejectInput) => jsonResult(await memReject(input, context)),
  );

  server.tool(
    "mem_pending",
    [
      "List memories in 'proposed' status awaiting review, sorted by read count.",
      "",
      "USE IN MANUAL MODE to see what memories are waiting for human review.",
      "In autopilot mode, proposed memories auto-approve after 72h.",
      "",
      "High read_count on a proposed memory = many agents found it useful without",
      "rejecting it = strong signal to approve.",
      "",
      "RETURNS: array of { id, type, scope, read_count, created_at, body_preview }",
    ].join("\n"),
    MemPendingInputSchema,
    async (input: MemPendingInput) => jsonResult(await memPending(input, context)),
  );

  server.tool(
    "mem_delete",
    [
      "Permanently delete a memory by id.",
      "",
      "USE WITH CAUTION — prefer mem_reject for outdated memories (preserves history).",
      "Use delete only for accidentally created memories or duplicates.",
      "",
      "PARAMETERS:",
      "  id            — full memory id to delete",
      "  delete_usage  — also delete usage stats (default: true)",
      "",
      "RETURNS: { deleted: true, id }",
    ].join("\n"),
    MemDeleteInputSchema,
    async (input: MemDeleteInput) => jsonResult(await memDelete(input, context)),
  );

  // ── v0.5.0: granular alternatives to get_briefing ─────────────────────
  // Use these when you don't need the full one-shot briefing payload.

  server.tool(
    "get_recap",
    [
      "Return ONLY the most recent session_recap. Cheaper than get_briefing when",
      "you just want to know 'what was I doing last time?' and don't need project",
      "context, modules, or memory ranking.",
      "",
      "PARAMETERS:",
      "  scope — 'personal' | 'team' | 'any' (default 'any', returns the most recent across both)",
      "",
      "RETURNS: { recap: { id, scope, revision_count, created_at, body } | null, notice? }",
    ].join("\n"),
    GetRecapInputSchema,
    async (input: GetRecapInput) => {
      tracker.record("get_recap", input.scope);
      return jsonResult(await getRecap(input, context));
    },
  );

  server.tool(
    "mem_relevant_to",
    [
      "One-shot ranked memories for a task — use instead of get_briefing when",
      "project context is already loaded and you only want the relevant memory layer.",
      "",
      "Reuses the same ranking pipeline (anchor / module / literal / semantic) but",
      "skips project_context, modules, action_required, etc.",
      "",
      "PARAMETERS:",
      "  task    — 1–2 sentences describing what you are about to do (required)",
      "  files   — files you'll edit (surfaces anchored memories)",
      "  limit   — cap on returned memories (default 8)",
      "  min_semantic_score — drop weak semantic hits below this cosine (default 0.25)",
      "",
      "RETURNS: { task, search_mode, memories: [...], hints?: [...], empty?: true }",
    ].join("\n"),
    MemRelevantToInputSchema,
    async (input: MemRelevantToInput) => {
      tracker.record("mem_relevant_to", input.task.slice(0, 80));
      return jsonResult(await memRelevantTo(input, context));
    },
  );

  // ── v0.5.0: code semantic search ──────────────────────────────────────

  server.tool(
    "code_search",
    [
      "Semantic search over the codebase — finds exported symbols (functions, classes,",
      "interfaces) related to a natural-language query. Replaces blind grep when you",
      "don't know the exact symbol name.",
      "",
      "Requires `haive index code-search` to have been run (builds embeddings for every",
      "exported symbol from the code-map). Falls back to a notice when index is missing.",
      "",
      "PARAMETERS:",
      "  query     — natural language (e.g. 'function that hashes passwords', 'JWT signing')",
      "  k         — number of top hits (default 5)",
      "  min_score — minimum cosine similarity (default 0.2; try 0.3+ for stricter)",
      "",
      "RETURNS: { available: bool, hits: [{ file, name, kind, line, description?, score }] }",
    ].join("\n"),
    CodeSearchInputSchema,
    async (input: CodeSearchInput) => {
      tracker.record("code_search", input.query.slice(0, 80));
      return jsonResult(await codeSearch(input, context));
    },
  );

  // ── v0.5.0: file-context lookup ───────────────────────────────────────

  server.tool(
    "why_this_file",
    [
      "One-shot file-context lookup: combines recent git history, memories anchored",
      "to the path, and the code-map entry. Answers 'why is this file the way it is?'",
      "in a single call instead of 3-4 manual ones.",
      "",
      "PARAMETERS:",
      "  path           — project-relative path (required)",
      "  git_log_limit  — recent commits to include (default 5)",
      "  memory_limit   — anchored memories cap (default 5)",
      "",
      "RETURNS: { file, exists, recent_commits: [...], memories: [...], code_map_entry, hints? }",
    ].join("\n"),
    WhyThisFileInputSchema,
    async (input: WhyThisFileInput) => {
      tracker.record("why_this_file", input.path);
      return jsonResult(await whyThisFile(input, context));
    },
  );

  // ── v0.5.0: anti-patterns check ───────────────────────────────────────

  server.tool(
    "anti_patterns_check",
    [
      "Scan a diff (or set of paths) against documented attempt/gotcha memories.",
      "Surfaces 'you are about to repeat a known mistake' warnings BEFORE you commit.",
      "",
      "USE BEFORE finalizing a non-trivial change. Cheap and high-signal: the only",
      "memories scanned are 'attempt' and 'gotcha' types.",
      "",
      "PARAMETERS:",
      "  diff     — raw unified diff text (or any code snippet) — optional if `paths` provided",
      "  paths    — affected file paths (optional if `diff` provided)",
      "  limit    — cap on returned warnings (default 8)",
      "  semantic — also use semantic search (default true; requires embeddings index)",
      "",
      "RETURNS: { scanned, warnings: [{ id, type, scope, confidence, body_preview, reasons, semantic_score? }] }",
    ].join("\n"),
    AntiPatternsCheckInputSchema,
    async (input: AntiPatternsCheckInput) => {
      tracker.record("anti_patterns_check", input.paths.join(",").slice(0, 80));
      return jsonResult(await antiPatternsCheck(input, context));
    },
  );

  // ── v0.6.0 additions ───────────────────────────────────────────────────

  server.tool(
    "mem_distill",
    [
      "Cluster recurring observations / failed attempts so a human can collapse",
      "N similar memories into one richer convention/gotcha. Cheap heuristic",
      "(anchor path overlap + body keyword overlap) — no embeddings required.",
      "",
      "USE periodically (e.g. monthly) to prevent memory pollution from agents",
      "saving the same observation many times.",
      "",
      "PARAMETERS:",
      "  since_days   — only consider memories from the last N days (default 30)",
      "  min_cluster  — minimum cluster size to surface (default 3)",
      "  type_filter  — 'gotcha' | 'attempt' | 'all' (default 'gotcha')",
      "  scope        — 'personal' | 'team' | 'module' | 'any' (default 'any')",
      "",
      "RETURNS: { scanned, singletons, clusters: [{ suggested_topic, member_ids, ... }] }",
      "Output is advisory — nothing is written to disk.",
    ].join("\n"),
    MemDistillInputSchema,
    async (input: MemDistillInput) => {
      tracker.record("mem_distill", `${input.type_filter}/since=${input.since_days}d`);
      return jsonResult(await memDistill(input, context));
    },
  );

  server.tool(
    "why_this_decision",
    [
      "Trace the genealogy of a memory (especially decision/architecture):",
      "the memory itself + memories explicitly linked via related_ids + memories",
      "anchored to overlapping paths + recent commits touching those paths.",
      "",
      "USE WHEN you find a memory and need to understand WHY it was made and",
      "what surrounds it. One call instead of 4-5 manual lookups.",
      "",
      "PARAMETERS:",
      "  id            — memory id (required)",
      "  git_log_limit — how many recent commits per anchor path (default 5)",
      "",
      "RETURNS: { decision, related: [...], path_neighbors: [...], recent_commits: [...] }",
    ].join("\n"),
    WhyThisDecisionInputSchema,
    async (input: WhyThisDecisionInput) => {
      tracker.record("why_this_decision", input.id);
      return jsonResult(await whyThisDecision(input, context));
    },
  );

  server.tool(
    "mem_conflicts_with",
    [
      "Detect memories that potentially CONTRADICT a given memory.",
      "",
      "USE BEFORE relying on a memory's advice — surfaces 'another memory says",
      "the opposite'. Detection uses several heuristics layered together:",
      "",
      "  1. Opposite status — validated vs rejected on overlapping topic",
      "  2. attempt-vs-convention on overlapping anchor paths",
      "  3. Polarity keywords — 'use X' vs 'do not use X' among semantic neighbors",
      "  4. Explicit #contradicts:<id> tags in either body",
      "",
      "PARAMETERS:",
      "  id        — memory id to check (required)",
      "  min_score — minimum cosine similarity for semantic neighbors (default 0.5)",
      "  semantic  — use embeddings (default true)",
      "",
      "RETURNS: { found, target, scanned, conflicts: [{ id, reasons, similarity, ... }] }",
    ].join("\n"),
    MemConflictsInputSchema,
    async (input: MemConflictsInput) => {
      tracker.record("mem_conflicts_with", input.id);
      return jsonResult(await memConflicts(input, context));
    },
  );

  server.tool(
    "pre_commit_check",
    [
      "One-shot 'should I block this commit?' check. Combines three signals:",
      "",
      "  1. anti_patterns_check — known gotchas/attempts that match the diff",
      "  2. mem_for_files       — conventions/decisions anchored to touched files",
      "  3. mem_verify          — memories whose anchors are stale (knowledge may be wrong)",
      "",
      "USE FROM A GIT HOOK or before finalizing a non-trivial change.",
      "",
      "PARAMETERS:",
      "  diff       — raw unified diff text (e.g. `git diff --cached`)",
      "  paths      — affected file paths (project-relative)",
      "  block_on   — 'any' | 'high-confidence' (default) | 'never'",
      "  semantic   — use embeddings in anti_patterns_check (default true)",
      "",
      "RETURNS: { should_block, summary, warnings, relevant_memories, stale_anchors }",
    ].join("\n"),
    PreCommitCheckInputSchema,
    async (input: PreCommitCheckInput) => {
      tracker.record("pre_commit_check", `${input.paths.length}p`);
      return jsonResult(await preCommitCheck(input, context));
    },
  );

  server.tool(
    "pattern_detect",
    [
      "Heuristic memory detector — finds knowledge worth saving WITHOUT calling an LLM.",
      "",
      "Runs three signals over local git history and the tool-usage log:",
      "  1. CONFIG_CHANGE — config files modified recently (tsconfig, eslint, prettier, …)",
      "     → proposes a convention memory with the git diff as body.",
      "  2. REPEATED_PATH — same file appears ≥3× in mem_tried/mem_observe events",
      "     → proposes a gotcha memory anchored to that path.",
      "  3. HOT_FILE — source file referenced ≥3× in writing-tool events",
      "     → proposes a convention memory (frequent edits = pattern emerging).",
      "",
      "Saves memories with status='proposed'. They feed into auto-promote (Phase 4)",
      "or are surfaced in the next post_task distillation for LLM review.",
      "",
      "USE periodically (e.g. end of sprint) or trigger from post-commit hook.",
      "",
      "PARAMETERS:",
      "  since_days — look-back window in days (default 7)",
      "  dry_run    — report matches without saving (default false)",
      "  scope      — 'team' (default) | 'personal'",
      "",
      "RETURNS: { scanned_events, matches: [{kind, signal, proposed_type, …}], saved, saved_ids }",
    ].join("\n"),
    PatternDetectInputSchema,
    async (input: PatternDetectInput) => {
      tracker.record("pattern_detect", `since=${input.since_days}d/dry_run=${input.dry_run}`);
      return jsonResult(await patternDetect(input, context));
    },
  );

  server.tool(
    "mem_diff",
    [
      "Compare two memories side-by-side to decide if they should be merged.",
      "",
      "USE BEFORE merging or deduplicating similar memories.",
      "Shows: frontmatter fields that differ + lines unique to each body.",
      "",
      "PARAMETERS:",
      "  id_a — first memory id",
      "  id_b — second memory id",
      "",
      "RETURNS: { frontmatter_diff: {...}, body_only_in_a: [...], body_only_in_b: [...] }",
    ].join("\n"),
    MemDiffInputSchema,
    async (input: MemDiffInput) => jsonResult(await memDiff(input, context)),
  );

  server.prompt(
    "bootstrap_project",
    [
      "Analyze the project codebase and write .ai/project-context.md — run once after haive init.",
      "The AI explores the directory structure, reads key files (package.json, README, config),",
      "identifies the tech stack, architectural patterns, key modules, and conventions,",
      "then persists everything via bootstrap_project_save.",
      "For multi-component projects, run with module param to create .ai/modules/<name>/context.md.",
    ].join(" "),
    BootstrapProjectArgsSchema,
    (args: BootstrapProjectArgs) => bootstrapProjectPrompt(args, context),
  );

  server.prompt(
    "post_task",
    [
      "⭐ Post-task reflection — run at the end of every session to capture what you learned:",
      "failed approaches (mem_tried), new conventions/decisions/gotchas (mem_save),",
      "code discoveries (mem_observe), and an end-of-session recap (mem_session_end).",
      "In autopilot mode a minimal recap saves automatically; calling this produces a richer one.",
    ].join(" "),
    PostTaskArgsSchema,
    (args: PostTaskArgs) => postTaskPrompt(args, context),
  );

  server.prompt(
    "import_docs",
    [
      "Import knowledge from a document (README, ADR, wiki, API spec) as hAIve memories.",
      "Pass the full document content; the AI extracts up to 10 actionable memories",
      "(conventions, decisions, gotchas, architecture) and saves them via mem_save.",
      "Good candidates: ADRs, onboarding docs, runbooks, team wikis.",
    ].join(" "),
    ImportDocsArgsSchema,
    (args: ImportDocsArgs) => importDocsPrompt(args, context),
  );

  return { server, context, tracker };
}

// ── Stdio runtime (also invoked by `haive mcp --stdio` via bundled CLI) ─────

/** Parse argv for the standalone haive-mcp binary / CLI subprocess parity. */
export function parseMcpCliArgs(argv: string[]): {
  root?: string;
  versionOnly: boolean;
} {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--version" || arg === "-V") {
      return { versionOnly: true };
    }
  }
  const out: { root?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" || arg === "-r") {
      out.root = argv[++i];
    } else if (arg?.startsWith("--root=")) {
      out.root = arg.slice("--root=".length);
    }
  }
  return { root: out.root, versionOnly: false };
}

/** Print MCP server version (same as haive CLI when bundled together). */
export function printHaiveMcpVersion(): void {
  console.log(SERVER_VERSION);
}

/**
 * Run the MCP server over stdio. Used by `haive-mcp` and by `haive mcp --stdio`
 * when the MCP implementation is bundled into the CLI.
 */
export async function runHaiveMcpStdio(options: { root?: string }): Promise<void> {
  const { server, context } = createHaiveServer({ root: options.root });
  console.error(
    `[haive-mcp] starting server v${SERVER_VERSION} (project root: ${context.paths.root})`,
  );
  await server.connect(new StdioServerTransport());
}
