import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  allocateBudget,
  deriveConfidence,
  estimateTokens,
  getUsage,
  inferModulesFromPaths,
  isDecaying,
  literalMatchesAllTokens,
  literalMatchesAnyToken,
  loadCodeMap,
  loadConfig,
  loadMemoriesFromDir,
  loadUsageIndex,
  memoryMatchesAnchorPaths,
  queryCodeMap,
  tokenizeQuery,
  trackReads,
  truncateToTokens,
  type ConfidenceLevel,
  type LoadedMemory,
  type UsageIndex,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";
import { pendingDistillPath, type PendingDistill } from "../session-tracker.js";

export const GetBriefingInputSchema = {
  task: z
    .string()
    .optional()
    .describe(
      "What you are about to do, in 1–2 sentences. Used to rank relevant memories semantically.",
    ),
  files: z
    .array(z.string())
    .default([])
    .describe("Project-relative file paths the agent is currently looking at or about to edit"),
  max_tokens: z
    .number()
    .int()
    .positive()
    .default(8000)
    .describe(
      "Approximate token budget for the entire briefing. Each section is allocated a share and truncated to fit.",
    ),
  max_memories: z
    .number()
    .int()
    .positive()
    .default(8)
    .describe("Cap on memories surfaced regardless of token budget"),
  include_project_context: z.boolean().default(true),
  include_module_contexts: z.boolean().default(true),
  semantic: z
    .boolean()
    .default(true)
    .describe(
      "Use semantic ranking when a task is provided (requires `haive embeddings index`).",
    ),
  include_stale: z
    .boolean()
    .default(false)
    .describe("Include stale memories (excluded by default — they may be outdated)"),
  track: z.boolean().default(true).describe("Increment read_count on returned memories"),
  format: z
    .enum(["full", "compact"])
    .default("full")
    .describe(
      "Output format: 'full' returns complete memory bodies; 'compact' returns id + 1-line summary only (call mem_get for details).",
    ),
  symbols: z
    .array(z.string())
    .default([])
    .describe(
      "Symbol names to look up in the code-map (e.g. ['PaymentService', 'TenantFilter']). " +
      "Returns the file(s) exporting each symbol so agents don't need to grep. " +
      "Requires `haive index code` to have been run.",
    ),
  min_semantic_score: z
    .number()
    .min(0)
    .max(1)
    .default(0)
    .describe(
      "Drop semantic-only memory hits whose cosine score is below this threshold. " +
      "Useful to avoid weakly-related noise when the task is short or the corpus is broad. " +
      "Has no effect on memories matched via anchor/module/literal — those are always kept. " +
      "Try 0.25–0.4 for stricter matching.",
    ),
};

export type GetBriefingInput = {
  [K in keyof typeof GetBriefingInputSchema]: z.infer<(typeof GetBriefingInputSchema)[K]>;
};

export interface BriefingMemory {
  id: string;
  scope: string;
  type: string;
  module?: string;
  tags: string[];
  status: string;
  confidence: ConfidenceLevel;
  /** Present when confidence is 'low' or 'unverified' — AI should weight this memory cautiously. */
  unverified?: true;
  read_count: number;
  reasons: Array<"anchor" | "module" | "domain" | "semantic">;
  match_quality: "exact" | "partial" | "semantic";
  semantic_score?: number;
  body: string;
  file_path: string;
}

export interface CodeMapSymbolHit {
  symbol: string;
  /** files that export this symbol */
  locations: Array<{
    file: string;
    kind: string;
    line: number;
    description?: string;
  }>;
}

export interface ActionRequiredItem {
  /** Memory id containing the alert */
  id: string;
  /** Short human-readable summary of the issue */
  summary: string;
  /**
   * The exact message to show the developer before doing anything.
   * Copy-paste this verbatim — do NOT paraphrase or act before confirmation.
   */
  developer_message: string;
}

export interface BriefingOutput {
  task?: string;
  search_mode: "semantic" | "literal_fallback" | "literal";
  match_quality_note?: string;
  inferred_modules: string[];
  last_session?: { id: string; scope: string; revision_count: number; body: string };
  project_context: { content: string; truncated: boolean; is_template?: boolean; auto_generated?: boolean } | null;
  module_contexts: Array<{ name: string; content: string; truncated: boolean }>;
  memories: BriefingMemory[];
  symbol_locations?: CodeMapSymbolHit[];
  /**
   * Memories that require explicit human confirmation before any code action.
   * IMPORTANT: for each item, show developer_message to the developer and
   * wait for explicit approval before modifying any code.
   * These are surfaced separately from memories to make them impossible to miss.
   */
  action_required: ActionRequiredItem[];
  decay_warnings: string[];
  setup_warnings: string[];
  /**
   * True when this briefing carries little actionable signal:
   * - project-context.md is still the default template
   * - no memories matched the task (or none exist at all)
   * - no previous session recap
   * Clients can use this flag to skip surfacing a near-empty briefing to the model.
   */
  low_value?: true;
  /**
   * Short, action-oriented hints surfaced to the agent based on the briefing payload.
   * Examples: "haive is uninitialized — use Read/Grep directly", "gotcha memories present — read first".
   * Always non-empty when low_value=true.
   */
  hints?: string[];
  estimated_tokens: number;
  budget: { max_tokens: number; spent: { project: number; modules: number; memories: number } };
}

export async function getBriefing(
  input: GetBriefingInput,
  ctx: HaiveContext,
): Promise<BriefingOutput> {
  const inferred = inferModulesFromPaths(input.files);
  const memories: BriefingMemory[] = [];
  let searchMode: BriefingOutput["search_mode"] = "literal";
  let usage: UsageIndex = { version: 1, updated_at: "", by_id: {} };
  let byId = new Map<string, LoadedMemory>();

  // ── Session recap ──────────────────────────────────────────────────────
  let lastSession: BriefingOutput["last_session"] | undefined;

  if (existsSync(ctx.paths.memoriesDir)) {
    const allLoaded = await loadMemoriesFromDir(ctx.paths.memoriesDir);

    // Find the most recent session_recap (by created_at) — exclude from main ranking
    const recaps = allLoaded
      .filter(({ memory }) => memory.frontmatter.type === "session_recap")
      .sort((a, b) =>
        new Date(b.memory.frontmatter.created_at).getTime() -
        new Date(a.memory.frontmatter.created_at).getTime(),
      );
    if (recaps.length > 0) {
      const r = recaps[0]!;
      const fm = r.memory.frontmatter;
      lastSession = {
        id: fm.id,
        scope: fm.scope,
        revision_count: fm.revision_count ?? 0,
        body: r.memory.body,
      };
    }

    const allMemories = allLoaded.filter(({ memory }) => {
      const s = memory.frontmatter.status;
      if (s === "rejected" || s === "deprecated") return false;
      if (!input.include_stale && s === "stale") return false;
      // session_recap surfaces separately in last_session, not in the ranked memories list
      if (memory.frontmatter.type === "session_recap") return false;
      return true;
    });
    usage = await loadUsageIndex(ctx.paths);
    // Build the id→loaded map up-front so the semantic-hits loop below
    // (and the related-id expansion later) can resolve hits to LoadedMemory.
    // Pre-fix: byId was assigned only after the semantic loop, so semantic hits
    // were silently dropped — search_mode said "semantic" but no memory ever
    // received a semantic_score. Fixed in v0.5.0.
    byId = new Map(allMemories.map((m) => [m.memory.frontmatter.id, m]));
    const semanticHits = input.task && input.semantic
      ? await trySemanticHits(ctx, input.task, allMemories.length * 2)
      : null;

    if (input.task && input.semantic) {
      searchMode = semanticHits ? "semantic" : "literal_fallback";
    }

    const seen = new Map<string, BriefingMemory>();

    const addOrUpdate = (
      loaded: LoadedMemory,
      reason: BriefingMemory["reasons"][number],
      score?: number,
      matchQuality?: BriefingMemory["match_quality"],
    ): void => {
      const fm = loaded.memory.frontmatter;
      const existing = seen.get(fm.id);
      if (existing) {
        if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
        if (score !== undefined && (existing.semantic_score ?? 0) < score) {
          existing.semantic_score = score;
        }
        // upgrade match_quality if better evidence found
        if (matchQuality === "exact" && existing.match_quality !== "exact") {
          existing.match_quality = "exact";
        } else if (matchQuality === "semantic" && existing.match_quality === "partial") {
          existing.match_quality = "semantic";
        }
        return;
      }
      const u = getUsage(usage, fm.id);
      seen.set(fm.id, {
        id: fm.id,
        scope: fm.scope,
        type: fm.type,
        ...(fm.module ? { module: fm.module } : {}),
        tags: fm.tags,
        status: fm.status,
        confidence: deriveConfidence(fm, u),
        ...(fm.status === "draft" || fm.status === "proposed" ? { unverified: true as const } : {}),
        read_count: u.read_count,
        reasons: [reason],
        match_quality: matchQuality ?? "partial",
        ...(score !== undefined ? { semantic_score: score } : {}),
        body: loaded.memory.body,
        file_path: loaded.filePath,
      });
    };

    if (input.files.length > 0) {
      for (const loaded of allMemories) {
        if (memoryMatchesAnchorPaths(loaded.memory, input.files)) addOrUpdate(loaded, "anchor", undefined, "exact");
      }
      for (const loaded of allMemories) {
        const fm = loaded.memory.frontmatter;
        if (fm.module && inferred.includes(fm.module)) addOrUpdate(loaded, "module", undefined, "partial");
        if (fm.domain && inferred.includes(fm.domain)) addOrUpdate(loaded, "domain", undefined, "partial");
        if (fm.tags.some((t) => inferred.includes(t))) addOrUpdate(loaded, "module", undefined, "partial");
      }
    }

    if (input.task) {
      const tokens = tokenizeQuery(input.task);
      // AND first — exact match
      const andHits = allMemories.filter((m) => literalMatchesAllTokens(m.memory, tokens));
      for (const loaded of andHits) {
        addOrUpdate(loaded, "semantic", undefined, "exact");
      }
      // OR fallback — if AND produced nothing, partial match is better than nothing
      if (andHits.length === 0 && tokens.length > 1) {
        for (const loaded of allMemories) {
          if (literalMatchesAnyToken(loaded.memory, tokens)) {
            addOrUpdate(loaded, "semantic", undefined, "partial");
          }
        }
      }
      if (semanticHits) {
        for (const hit of semanticHits) {
          // Filter out weakly-related semantic hits when caller asked for a stricter threshold.
          // Memories already attached via anchor/module/literal stay (addOrUpdate just upgrades them).
          if (hit.score < input.min_semantic_score) {
            const existing = seen.get(hit.id);
            if (!existing) continue;
          }
          const loaded = byId.get(hit.id);
          if (loaded) addOrUpdate(loaded, "semantic", hit.score, "semantic");
        }
      }
    }

    const ranked = [...seen.values()].sort((a, b) => {
      const reasonScore = (m: BriefingMemory): number =>
        (m.type === "attempt" ? 3 : 0) + // attempt = negative knowledge, surface first to prevent repeating mistakes
        (m.reasons.includes("anchor") ? 4 : 0) +
        (m.reasons.includes("module") ? 2 : 0) +
        (m.reasons.includes("semantic") ? 2 : 0) +
        (m.reasons.includes("domain") ? 1 : 0);
      const confidenceScore = (m: BriefingMemory): number =>
        m.confidence === "authoritative" ? 4 :
        m.confidence === "trusted" ? 3 :
        m.confidence === "low" ? 1 :
        m.confidence === "stale" ? -2 : 0;
      const sa = reasonScore(a) + confidenceScore(a) + (a.semantic_score ?? 0);
      const sb = reasonScore(b) + confidenceScore(b) + (b.semantic_score ?? 0);
      return sb - sa;
    });

    // Expand related_ids: pull in memories linked from the top results
    // (byId was already populated above, before the semantic-hits loop)
    for (const mem of ranked.slice(0, input.max_memories)) {
      if (seen.size >= input.max_memories * 2) break;
      const loaded = byId.get(mem.id);
      if (!loaded) continue;
      for (const relId of loaded.memory.frontmatter.related_ids ?? []) {
        if (seen.has(relId)) continue;
        const related = byId.get(relId);
        if (related) addOrUpdate(related, "anchor", undefined, "partial");
      }
    }

    memories.push(...ranked.slice(0, input.max_memories));

    if (input.track && memories.length > 0) {
      await trackReads(ctx.paths, memories.map((m) => m.id));
    }
  }

  // Build raw section payloads
  const projectContextRaw =
    input.include_project_context && existsSync(ctx.paths.projectContext)
      ? await readFile(ctx.paths.projectContext, "utf8")
      : "";
  const isTemplateContext =
    projectContextRaw.includes("TODO — high-level overview") ||
    projectContextRaw.includes("Generated by `haive init`");

  const setupWarnings: string[] = [];
  let autoContextGenerated = false;

  // In autopilot mode: if project-context.md is still the template, auto-generate
  // a minimal context from the code-map so get_briefing is useful immediately.
  let projectContext = isTemplateContext ? "" : projectContextRaw;
  if ((isTemplateContext || !existsSync(ctx.paths.projectContext)) && input.include_project_context) {
    const haiveConfig = await loadConfig(ctx.paths);
    if (haiveConfig.autoContext) {
      const codeMap = await loadCodeMap(ctx.paths);
      if (codeMap) {
        const totalFiles = Object.keys(codeMap.files).length;
        const extensions = new Map<string, number>();
        for (const filePath of Object.keys(codeMap.files)) {
          const ext = filePath.slice(filePath.lastIndexOf(".") + 1).toLowerCase();
          extensions.set(ext, (extensions.get(ext) ?? 0) + 1);
        }
        const topExts = [...extensions.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([e, n]) => `${e} (${n})`)
          .join(", ");

        // Pick top exported symbols as a starting overview
        const topSymbols = Object.entries(codeMap.files)
          .flatMap(([fp, entry]) =>
            entry.exports.slice(0, 3).map((e) => `${e.name} (${fp.split("/").slice(-2).join("/")})`),
          )
          .slice(0, 15)
          .join(", ");

        projectContext =
          `# Project context (auto-generated by hAIve)\n\n` +
          `> ⚠ This is a minimal auto-generated context based on the code-map. ` +
          `Invoke the \`bootstrap_project\` MCP prompt to replace it with a full analysis.\n\n` +
          `## Codebase overview\n` +
          `- **${totalFiles} files** indexed in code-map\n` +
          `- **Main file types:** ${topExts}\n` +
          `- **Generated at:** ${codeMap.generated_at}\n\n` +
          `## Key exports (sample)\n` +
          topSymbols + "\n";

        autoContextGenerated = true;
        setupWarnings.push(
          "project-context.md is still the default template. " +
          "A minimal auto-generated context has been injected from the code-map. " +
          "Invoke bootstrap_project to replace it with a full AI-analyzed context.",
        );
      } else {
        setupWarnings.push(
          "project-context.md is still the default template and no code-map found. " +
          "Run `haive index code` then invoke bootstrap_project for a full context.",
        );
      }
    } else {
      if (isTemplateContext) {
        setupWarnings.push(
          "project-context.md still contains the default template. " +
          "Invoke the bootstrap_project MCP prompt to auto-fill it from your codebase. " +
          "Until then, get_briefing returns no project context.",
        );
      } else {
        setupWarnings.push(
          "No project-context.md found. Run `haive init` then invoke the bootstrap_project MCP prompt.",
        );
      }
    }
  }

  const moduleContents = input.include_module_contexts
    ? await loadModuleContexts(ctx, inferred)
    : [];

  const memoriesText = memories
    .map((m) => {
      const unverified = m.status === "proposed" ? " [UNVERIFIED — not yet validated]" : "";
      return `### ${m.id} (${m.scope}/${m.type}, ${m.confidence})${unverified}\n${m.body.trim()}`;
    })
    .join("\n\n---\n\n");

  // Allocate budget across the three large pieces
  const slices = allocateBudget(
    [
      { key: "project", text: projectContext, weight: 3, mode: "head" },
      {
        key: "modules",
        text: moduleContents.map((m) => `## ${m.name}\n${m.content}`).join("\n\n---\n\n"),
        weight: 3,
        mode: "head",
      },
      { key: "memories", text: memoriesText, weight: 4, mode: "head" },
    ],
    input.max_tokens,
  );

  const projectSlice = slices.find((s) => s.key === "project")!;
  const modulesSlice = slices.find((s) => s.key === "modules")!;
  const memoriesSlice = slices.find((s) => s.key === "memories")!;

  const trimmedModules: BriefingOutput["module_contexts"] = [];
  if (modulesSlice.text.length > 0 && moduleContents.length > 0) {
    // Distribute the modules slice across module entries proportionally
    const subSlices = allocateBudget(
      moduleContents.map((m) => ({ key: m.name, text: m.content, weight: 1, mode: "head" as const })),
      modulesSlice.allocatedTokens,
    );
    for (const m of moduleContents) {
      const sub = subSlices.find((s) => s.key === m.name)!;
      trimmedModules.push({ name: m.name, content: sub.text, truncated: sub.truncated });
    }
  }

  // Recompute memory bodies to fit using a cascade approach:
  // top-ranked memories get full budget first; lower-ranked ones are dropped if budget runs out.
  // This is better than uniform truncation which gives all memories a 37%-fragment.
  const trimmedMemories: BriefingMemory[] = [];
  if (!memoriesSlice.truncated) {
    trimmedMemories.push(...memories);
  } else {
    let remaining = memoriesSlice.allocatedTokens;
    for (const m of memories) {
      const bodyTokens = estimateTokens(m.body);
      if (remaining <= 0) break;
      if (bodyTokens <= remaining) {
        trimmedMemories.push(m);
        remaining -= bodyTokens;
      } else if (remaining > 80) {
        // Enough budget for a meaningful fragment — truncate and include
        const t = truncateToTokens(m.body, { maxTokens: remaining, mode: "head" });
        trimmedMemories.push({ ...m, body: t.text });
        remaining = 0;
      }
      // Otherwise skip — too small a fragment to be useful
    }
  }

  const totalTokens =
    projectSlice.estimatedTokens + modulesSlice.estimatedTokens + memoriesSlice.estimatedTokens;

  // Decay warnings: memories not read in >90 days
  const decayWarnings: string[] = [];
  for (const m of trimmedMemories) {
    const u = getUsage(usage, m.id);
    const loaded = byId.get(m.id);
    const createdAt = loaded?.memory.frontmatter.created_at ?? new Date().toISOString();
    if (isDecaying(u, createdAt)) decayWarnings.push(m.id);
  }

  // Compact format: replace body with 1-line summary
  const outputMemories =
    input.format === "compact"
      ? trimmedMemories.map((m) => ({ ...m, body: compactSummary(m.body) }))
      : trimmedMemories;

  // ── Code-map symbol lookup ──────────────────────────────────────────────
  // Also auto-look up symbols found in anchor paths of returned memories +
  // any explicit symbols[] the caller requested.
  let symbolLocations: CodeMapSymbolHit[] | undefined;
  const symbolsToLookup = new Set<string>(input.symbols);
  // Auto-collect symbols from memory anchors so agents get locations for free
  for (const m of outputMemories) {
    const loaded = byId.get(m.id);
    for (const sym of loaded?.memory.frontmatter.anchor.symbols ?? []) {
      symbolsToLookup.add(sym);
    }
  }
  if (symbolsToLookup.size > 0) {
    const codeMap = await loadCodeMap(ctx.paths);
    if (codeMap) {
      symbolLocations = [];
      for (const sym of symbolsToLookup) {
        const { files } = queryCodeMap(codeMap, { symbol: sym });
        if (files.length > 0) {
          symbolLocations.push({
            symbol: sym,
            locations: files.flatMap((f) =>
              f.entry.exports
                .filter((e) => e.name.toLowerCase().includes(sym.toLowerCase()))
                .map((e) => ({
                  file: f.path,
                  kind: e.kind,
                  line: e.line,
                  ...(e.description ? { description: e.description } : {}),
                })),
            ),
          });
        }
      }
      if (symbolLocations.length === 0) symbolLocations = undefined;
    }
  }

  // ── action_required: memories that need explicit human confirmation ──────
  const actionRequired: ActionRequiredItem[] = [];
  for (const m of outputMemories) {
    const loaded = byId.get(m.id);
    if (!loaded?.memory.frontmatter.requires_human_approval) continue;

    // Extract the developer message from the memory body (between the > quote block)
    const bodyLines = loaded.memory.body.split("\n");
    const quoteBlock = bodyLines
      .filter((l) => l.startsWith("> "))
      .map((l) => l.slice(2))
      .join(" ")
      .replace(/^\*«\s*/, "")
      .replace(/\s*»\*$/, "")
      .trim();

    // Build a short summary from the first heading
    const headingLine = bodyLines.find((l) => l.startsWith("## "));
    const summary = headingLine?.replace(/^##\s*/, "").trim() ?? m.id;

    actionRequired.push({
      id: m.id,
      summary,
      developer_message: quoteBlock ||
        `Une modification externe potentiellement incompatible a été détectée (${m.id}). ` +
        `Veux-tu que j'analyse l'impact et que je propose des mises à jour ?`,
    });
  }
  // Also load action_required memories that weren't in the ranked set
  // (they may not be relevant to the task but are still urgent)
  if (existsSync(ctx.paths.memoriesDir)) {
    const allMems = await loadMemoriesFromDir(ctx.paths.memoriesDir);
    for (const { memory } of allMems) {
      const fm = memory.frontmatter;
      if (!fm.requires_human_approval) continue;
      if (fm.status === "rejected" || fm.status === "deprecated") continue;
      if (actionRequired.some((a) => a.id === fm.id)) continue; // already included

      const bodyLines = memory.body.split("\n");
      const quoteBlock = bodyLines
        .filter((l) => l.startsWith("> "))
        .map((l) => l.slice(2))
        .join(" ")
        .replace(/^\*«\s*/, "")
        .replace(/\s*»\*$/, "")
        .trim();
      const headingLine = bodyLines.find((l) => l.startsWith("## "));
      const summary = headingLine?.replace(/^##\s*/, "").trim() ?? fm.id;

      actionRequired.push({
        id: fm.id,
        summary,
        developer_message: quoteBlock ||
          `Une modification externe potentiellement incompatible a été détectée (${fm.id}). ` +
          `Veux-tu que j'analyse l'impact et que je propose des mises à jour ?`,
      });
    }
  }

  // ── pending-distill: prompt agent to run post_task if shallow auto-recap ──
  // If the previous session was closed by autopilot (no manual post_task),
  // surface an action_required item so the LLM host distills learnings via
  // the post_task prompt. Auto-expires after 7 days (stale diff = useless).
  const pendingDistillFile = pendingDistillPath(ctx);
  if (existsSync(pendingDistillFile)) {
    try {
      const raw = await readFile(pendingDistillFile, "utf8");
      const pd = JSON.parse(raw) as PendingDistill;
      const ageMs = Date.now() - new Date(pd.session_end).getTime();
      const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
      if (ageMs < SEVEN_DAYS) {
        const savedNote = pd.memories_saved.length > 0
          ? ` ${pd.memories_saved.length} memor${pd.memories_saved.length === 1 ? "y was" : "ies were"} saved.`
          : " No memories were saved.";
        const diffNote = pd.git_diff_available
          ? " A git diff snapshot is available in the pending-distill file for context."
          : "";
        actionRequired.push({
          id: "__pending_distill__",
          summary: "Previous session has undistilled learnings — invoke post_task to capture them",
          developer_message:
            `The previous session (${pd.total_tool_calls} tool calls, ${pd.tool_summary}) ` +
            `was closed by autopilot without a full post_task distillation.${savedNote}${diffNote}\n\n` +
            `**Before starting your task:** invoke the MCP prompt \`post_task\` to capture any ` +
            `decisions, gotchas, or conventions from that session. This takes ~30 seconds and ` +
            `prevents institutional knowledge from being lost.\n\n` +
            `When done, call \`mem_session_end\` to acknowledge — this clears the pending distill marker.`,
        });
      } else {
        // Auto-expire stale pending distill (> 7 days old)
        try {
          const { rm } = await import("node:fs/promises");
          await rm(pendingDistillFile);
        } catch { /* non-fatal */ }
      }
    } catch { /* malformed or deleted between check and read — skip */ }
  }

  // ── low_value detection + hints ────────────────────────────────────────
  // A briefing is "low value" when the project has not been initialized yet
  // (template context + zero memories + no past session). Clients can short-circuit
  // and tell the model to use plain Read/Grep instead of paying for a near-empty briefing.
  const memoriesEmpty = outputMemories.length === 0;
  const hasMemoriesDir = existsSync(ctx.paths.memoriesDir);
  const isColdStart =
    isTemplateContext &&
    memoriesEmpty &&
    !lastSession &&
    !autoContextGenerated;

  const hints: string[] = [];
  if (isColdStart) {
    hints.push(
      "haive is uninitialized for this project (project-context.md is template, " +
      "0 memories, no past session). Skip future get_briefing calls until memories exist — " +
      "use Read/Grep directly. Run `haive init` and the bootstrap_project prompt to fix.",
    );
  } else {
    if (outputMemories.some((m) => m.type === "attempt")) {
      hints.push(
        "⚠️ One or more 'attempt' memories matched — these document failed approaches. " +
        "Read them BEFORE writing code to avoid repeating the mistake.",
      );
    }
    if (outputMemories.some((m) => m.type === "gotcha")) {
      hints.push(
        "Gotcha memories matched — non-obvious traps. Verify the 'how to apply' line still holds " +
        "before assuming behavior.",
      );
    }
    if (memoriesEmpty && hasMemoriesDir && input.task) {
      hints.push(
        "No memories matched this task. Try mem_search with broader/different terms, " +
        "or call mem_for_files with the files you intend to edit.",
      );
    }
    if (input.task && outputMemories.length > 0 && actionRequired.length === 0) {
      // Encourage capturing new knowledge proactively.
      hints.push(
        "After completing the task: capture new gotchas with mem_observe, " +
        "failed approaches with mem_tried, validated patterns with mem_save.",
      );
    }
  }

  return {
    ...(input.task ? { task: input.task } : {}),
    search_mode: searchMode,
    inferred_modules: inferred,
    ...(lastSession ? { last_session: lastSession } : {}),
    project_context: (projectContextRaw || autoContextGenerated)
      ? {
          content: projectSlice.text,
          truncated: projectSlice.truncated,
          ...(isTemplateContext && !autoContextGenerated ? { is_template: true } : {}),
          ...(autoContextGenerated ? { auto_generated: true } : {}),
        }
      : null,
    module_contexts: trimmedModules,
    memories: outputMemories,
    ...(symbolLocations ? { symbol_locations: symbolLocations } : {}),
    action_required: actionRequired,
    decay_warnings: decayWarnings,
    setup_warnings: setupWarnings,
    ...(isColdStart ? { low_value: true as const } : {}),
    ...(hints.length > 0 ? { hints } : {}),
    estimated_tokens: totalTokens,
    budget: {
      max_tokens: input.max_tokens,
      spent: {
        project: projectSlice.estimatedTokens,
        modules: modulesSlice.estimatedTokens,
        memories: memoriesSlice.estimatedTokens,
      },
    },
  };
}

function compactSummary(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.replace(/^#+\s*/, "").trim();
    if (trimmed.length > 0) return trimmed.slice(0, 120);
  }
  return body.slice(0, 120);
}

async function trySemanticHits(
  ctx: HaiveContext,
  task: string,
  limit: number,
): Promise<Array<{ id: string; score: number }> | null> {
  let mod: typeof import("@hiveai/embeddings");
  try {
    mod = await import("@hiveai/embeddings");
  } catch {
    return null;
  }
  const result = await mod.semanticSearch(ctx.paths, task, { limit });
  if (!result) return null;
  return result.hits.map((h) => ({ id: h.id, score: h.score }));
}

async function loadModuleContexts(
  ctx: HaiveContext,
  modules: string[],
): Promise<Array<{ name: string; content: string }>> {
  if (modules.length === 0) return [];
  if (!existsSync(ctx.paths.modulesContextDir)) return [];
  const available = new Set(
    (await readdir(ctx.paths.modulesContextDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name),
  );
  const out: Array<{ name: string; content: string }> = [];
  for (const m of modules) {
    if (!available.has(m)) continue;
    const file = path.join(ctx.paths.modulesContextDir, m, "context.md");
    if (existsSync(file)) {
      out.push({ name: m, content: await readFile(file, "utf8") });
    }
  }
  return out;
}

// Re-export estimateTokens at the module level for tests.
export { estimateTokens };
