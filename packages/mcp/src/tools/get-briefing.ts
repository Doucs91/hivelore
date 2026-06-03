import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  allocateBudget,
  computeImpact,
  DEFAULT_AUTO_PROMOTE_RULE,
  deriveConfidence,
  estimateTokens,
  evaluateSkillActivation,
  compactAutoRecapBody,
  extractActionsBriefBody,
  getUsage,
  inferModulesFromPaths,
  isAutoPromoteEligible,
  isDecaying,
  isRetiredMemory,
  literalMatchesAllTokens,
  literalMatchesAnyToken,
  loadCodeMap,
  loadConfig,
  hashProjectContext,
  loadMemoriesFromDir,
  loadUsageIndex,
  memoryMatchesAnchorPaths,
  projectContextRecentlyEmitted,
  rankMemoriesLexical,
  recordProjectContextEmission,
  queryCodeMap,
  resolveBriefingBudget,
  serializeMemory,
  specificityScore,
  GUESSABLE_THRESHOLD,
  tokenizeQuery,
  trackReads,
  truncateToTokens,
  writeBriefingMarker,
  type LoadedMemory,
  type UsageIndex,
} from "@hiveai/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";
import { pendingDistillPath, type PendingDistill } from "../session-tracker.js";
import type {
  ActionRequiredItem,
  BriefingMemory,
  BriefingOutput,
} from "./briefing-types.js";
import {
  classifyBriefingQuality,
  classifyMemoryPriority,
  compactSummary,
  explainWhySurfaced,
  loadModuleContexts,
  priorityRank,
  trySemanticHits,
} from "./briefing-helpers.js";

// Re-export types so existing importers (server.ts, mem-relevant-to.ts) don't need to change.
export type {
  ActionRequiredItem,
  BriefingMemory,
  BriefingMemoryPriority,
  BriefingOutput,
  BriefingQuality,
  CodeMapSymbolHit,
} from "./briefing-types.js";

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
  dedupe_project_context: z
    .boolean()
    .optional()
    .describe(
      "Token saver (default ON): skip re-emitting the project-context body if an identical copy was " +
      "already sent within the last few minutes this session (the agent still has it). Set false to always include it.",
    ),
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
    .enum(["full", "compact", "actions"])
    .default("full")
    .describe(
      "Output format: 'full' returns memory bodies (honors token budget via truncation); " +
      "'compact' returns a 1-line summary per memory (call mem_get for detail); " +
      "'actions' squeezes bodies to actionable bullet lines — fewer tokens vs full.",
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
  budget_preset: z
    .enum(["quick", "balanced", "deep"])
    .optional()
    .describe(
      "Shortcut token budget: 'quick' minimizes tokens/skip module CONTEXT slices; 'balanced' mirrors historical defaults; " +
      "'deep' uses a larger briefing. When set, overrides max_tokens, max_memories, and include_module_contexts.",
    ),
};

export const GetBriefingZod = z.object(GetBriefingInputSchema);
export type GetBriefingInput = z.infer<typeof GetBriefingZod>;

export async function getBriefing(
  input: GetBriefingInput,
  ctx: HaiveContext,
): Promise<BriefingOutput> {
  const resolvedBudget = resolveBriefingBudget(input.budget_preset, {
    max_tokens: input.max_tokens,
    max_memories: input.max_memories,
    include_module_contexts: input.include_module_contexts,
  });
  const briefingMaxTokens = resolvedBudget.max_tokens;
  const briefingMaxMemories = resolvedBudget.max_memories;
  const briefingIncludeModules = resolvedBudget.include_module_contexts;

  const inferred = inferModulesFromPaths(input.files);
  const memories: BriefingMemory[] = [];
  let searchMode: BriefingOutput["search_mode"] = "literal";
  let usage: UsageIndex = { version: 1, updated_at: "", by_id: {} };
  let byId = new Map<string, LoadedMemory>();

  // ── Session recap ──────────────────────────────────────────────────────
  let lastSession: BriefingOutput["last_session"] | undefined;

  if (existsSync(ctx.paths.memoriesDir)) {
    const allLoaded = await loadMemoriesFromDir(ctx.paths.memoriesDir);

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
        // Auto-generated recaps are low-signal tool dumps — compact them so they inform without
        // dominating the briefing head. Human/post_task recaps pass through unchanged.
        body: compactAutoRecapBody(r.memory.body),
      };
    }

    const allMemories = allLoaded.filter(({ memory }) => {
      const s = memory.frontmatter.status;
      if (s === "rejected" || s === "deprecated") return false;
      if (!input.include_stale && s === "stale") return false;
      if (!input.include_stale && isRetiredMemory(memory.frontmatter, memory.body)) return false;
      if (memory.frontmatter.type === "session_recap") return false;
      return true;
    });
    usage = await loadUsageIndex(ctx.paths);

    // byId MUST be populated before the semanticHits loop that uses it.
    // (gotcha: 2026-05-02-gotcha-getbriefing-semantic-hits-silently-dropped-byid)
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
        if (matchQuality === "exact" && existing.match_quality !== "exact") {
          existing.match_quality = "exact";
        } else if (matchQuality === "semantic" && existing.match_quality === "partial") {
          existing.match_quality = "semantic";
        }
        return;
      }
      const u = getUsage(usage, fm.id);
      const imp = computeImpact(fm, u);
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
        impact_score: imp.score,
        impact_tier: imp.tier,
        reasons: [reason],
        match_quality: matchQuality ?? "partial",
        ...(score !== undefined ? { semantic_score: score } : {}),
        priority: "background",
        body: loaded.memory.body,
        file_path: loaded.filePath,
      });
    };

    // ── Matching passes ────────────────────────────────────────────────────
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

    if (input.symbols.length > 0) {
      const wanted = new Set(input.symbols.map((s) => s.toLowerCase()));
      for (const loaded of allMemories) {
        const symbols = loaded.memory.frontmatter.anchor.symbols.map((s) => s.toLowerCase());
        if (symbols.some((s) => wanted.has(s))) addOrUpdate(loaded, "symbol", undefined, "exact");
      }
    }

    if (input.task) {
      const tokens = tokenizeQuery(input.task);
      const andHits = allMemories.filter((m) => literalMatchesAllTokens(m.memory, tokens));
      for (const loaded of andHits) addOrUpdate(loaded, "semantic", undefined, "exact");
      if (andHits.length === 0 && tokens.length > 1) {
        for (const loaded of allMemories) {
          if (literalMatchesAnyToken(loaded.memory, tokens)) addOrUpdate(loaded, "semantic", undefined, "partial");
        }
      }
      if (semanticHits) {
        for (const hit of semanticHits) {
          if (hit.score < input.min_semantic_score && !seen.has(hit.id)) continue;
          const loaded = byId.get(hit.id);
          if (loaded) addOrUpdate(loaded, "semantic", hit.score, "semantic");
        }
      }
    }

    // ── Progressive disclosure for skills ────────────────────────────────────
    // A skill that declares `activation` triggers is disclosed only when the task or
    // edited files match; an activated skill earns a ranking boost (it's a playbook
    // to follow now). Skills without an activation block keep legacy behavior.
    const activatedSkills = new Set<string>();
    for (const [id, m] of seen) {
      if (m.type !== "skill") continue;
      const loaded = byId.get(id);
      if (!loaded) continue;
      const act = evaluateSkillActivation(loaded.memory.frontmatter, {
        task: input.task,
        files: input.files,
      });
      if (act.applicable && !act.activated) {
        seen.delete(id);
        continue;
      }
      if (act.applicable && act.activated) activatedSkills.add(id);
    }

    // ── Lexical relevance (BM25) ─────────────────────────────────────────────
    // Semantic cosine alone (0..1) is too weak to overcome the type/confidence/impact
    // bonuses, so popular high-read attempt memories dominated EVERY task — the actually
    // relevant memory got buried. A BM25 score over the candidate set rewards overlap on
    // the query's *distinctive* terms (high IDF), pulling the on-topic memory up. It does
    // not touch anchored ranking: anchor/symbol hits stay must_read (priority * 100).
    const lexNorm = new Map<string, number>();
    if (input.task) {
      const candidates = [...seen.keys()]
        .map((id) => byId.get(id))
        .filter((x): x is LoadedMemory => Boolean(x));
      const lex = rankMemoriesLexical(candidates, input.task, candidates.length);
      const maxScore = lex.scores.reduce((m, s) => (s > m ? s : m), 0);
      if (maxScore > 0) {
        lex.ranked.forEach((loaded, i) => {
          lexNorm.set(loaded.memory.frontmatter.id, (lex.scores[i] ?? 0) / maxScore);
        });
      }
    }

    // ── Ranking ────────────────────────────────────────────────────────────
    const ranked = [...seen.values()].sort((a, b) => {
      const reasonScore = (m: BriefingMemory): number =>
        (m.type === "attempt" ? 3 : 0) +
        (m.reasons.includes("anchor") ? 4 : 0) +
        (m.reasons.includes("symbol") ? 4 : 0) +
        (m.reasons.includes("module") ? 2 : 0) +
        (m.reasons.includes("semantic") ? 2 : 0) +
        (m.reasons.includes("domain") ? 1 : 0);
      const confidenceScore = (m: BriefingMemory): number =>
        m.confidence === "authoritative" ? 4 :
        m.confidence === "trusted" ? 3 :
        m.confidence === "low" ? 1 :
        m.confidence === "stale" ? -2 : 0;
      // Demonstrated-utility nudge (0..3): a memory that agents actually applied — or
      // whose sensor caught a regression — edges out an equally-relevant one that
      // never proved useful. Small on purpose: never overrides anchor/symbol relevance.
      const impactScore = (m: BriefingMemory): number => (m.impact_score ?? 0) * 3;
      // An explicitly-activated skill is an actionable playbook for this exact task — surface it high.
      const activationBoost = (m: BriefingMemory): number => (activatedSkills.has(m.id) ? 5 : 0);
      // Lexical relevance weight (0..12): strong enough to lift the on-topic memory above a
      // popular-but-unrelated attempt (whose type+confidence head start is ~7), yet far below
      // the priority tier (×100) so anchored/symbol matches are never displaced.
      const lexScore = (m: BriefingMemory): number => 12 * (lexNorm.get(m.id) ?? 0);
      const sa = priorityRank(classifyMemoryPriority(a, byId.get(a.id), input.files, input.symbols)) * 100
        + reasonScore(a) + confidenceScore(a) + impactScore(a) + activationBoost(a) + lexScore(a) + (a.semantic_score ?? 0);
      const sb = priorityRank(classifyMemoryPriority(b, byId.get(b.id), input.files, input.symbols)) * 100
        + reasonScore(b) + confidenceScore(b) + impactScore(b) + activationBoost(b) + lexScore(b) + (b.semantic_score ?? 0);
      return sb - sa;
    });

    // Expand related_ids from top results
    for (const mem of ranked.slice(0, briefingMaxMemories)) {
      if (seen.size >= briefingMaxMemories * 2) break;
      const loaded = byId.get(mem.id);
      if (!loaded) continue;
      for (const relId of loaded.memory.frontmatter.related_ids ?? []) {
        if (seen.has(relId)) continue;
        const related = byId.get(relId);
        if (related) addOrUpdate(related, "anchor", undefined, "partial");
      }
    }

    memories.push(...ranked.slice(0, briefingMaxMemories));

    // ── Track reads + inline auto-promote ─────────────────────────────────
    if (input.track && memories.length > 0) {
      await trackReads(ctx.paths, memories.map((m) => m.id));
      const freshUsage = await loadUsageIndex(ctx.paths);
      // Use configured autoPromoteMinReads — not the hardcoded default.
      // (gotcha: 2026-05-04-gotcha-auto-promote-ignores-config-minreads)
      const cfg = await loadConfig(ctx.paths);
      const rule = {
        minReads: cfg.autoPromoteMinReads ?? DEFAULT_AUTO_PROMOTE_RULE.minReads,
        maxRejections: DEFAULT_AUTO_PROMOTE_RULE.maxRejections,
      };
      for (const m of memories) {
        const loaded = byId.get(m.id);
        if (!loaded) continue;
        const u = getUsage(freshUsage, m.id);
        if (!isAutoPromoteEligible(loaded.memory.frontmatter, u, rule)) continue;
        const newFm = { ...loaded.memory.frontmatter, status: "validated" as const };
        try {
          await writeFile(loaded.filePath, serializeMemory({ frontmatter: newFm, body: loaded.memory.body }), "utf8");
          m.status = "validated";
          m.confidence = "trusted";
        } catch { /* non-fatal */ }
      }
    }
  }

  // ── Project context ────────────────────────────────────────────────────
  let projectContextRaw =
    input.include_project_context && existsSync(ctx.paths.projectContext)
      ? await readFile(ctx.paths.projectContext, "utf8")
      : "";
  // Token saver: within a session, don't re-emit an UNCHANGED project context — the agent already
  // has it from the earlier call. First emission records a marker; repeats within the window omit.
  let contextOmittedRecent = false;
  if (projectContextRaw && input.dedupe_project_context !== false) {
    const ctxHash = hashProjectContext(projectContextRaw);
    if (await projectContextRecentlyEmitted(ctx.paths, ctxHash)) {
      contextOmittedRecent = true;
      projectContextRaw = "";
    } else {
      await recordProjectContextEmission(ctx.paths, ctxHash);
    }
  }
  const isTemplateContext =
    projectContextRaw.includes("TODO — high-level overview") ||
    projectContextRaw.includes("Generated by `haive init`");

  const setupWarnings: string[] = [];
  let autoContextGenerated = false;
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
      setupWarnings.push(
        isTemplateContext
          ? "project-context.md still contains the default template. " +
            "Invoke the bootstrap_project MCP prompt to auto-fill it from your codebase. " +
            "Until then, get_briefing returns no project context."
          : "No project-context.md found. Run `haive init` then invoke the bootstrap_project MCP prompt.",
      );
    }
  }

  // ── Module contexts + budget allocation ───────────────────────────────
  const moduleContents = briefingIncludeModules
    ? await loadModuleContexts(ctx, inferred)
    : [];

  const memoriesText = memories
    .map((m) => {
      const unverified = m.status === "proposed" ? " [UNVERIFIED — not yet validated]" : "";
      return `### ${m.id} (${m.scope}/${m.type}, ${m.confidence})${unverified}\n${m.body.trim()}`;
    })
    .join("\n\n---\n\n");

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
    briefingMaxTokens,
  );

  const projectSlice = slices.find((s) => s.key === "project")!;
  const modulesSlice = slices.find((s) => s.key === "modules")!;
  const memoriesSlice = slices.find((s) => s.key === "memories")!;

  const trimmedModules: BriefingOutput["module_contexts"] = [];
  if (modulesSlice.text.length > 0 && moduleContents.length > 0) {
    const subSlices = allocateBudget(
      moduleContents.map((m) => ({ key: m.name, text: m.content, weight: 1, mode: "head" as const })),
      modulesSlice.allocatedTokens,
    );
    for (const m of moduleContents) {
      const sub = subSlices.find((s) => s.key === m.name)!;
      trimmedModules.push({ name: m.name, content: sub.text, truncated: sub.truncated });
    }
  }

  // Cascade budget: top-ranked memories get full budget first; lower-ranked are dropped.
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
        const t = truncateToTokens(m.body, { maxTokens: remaining, mode: "head" });
        trimmedMemories.push({ ...m, body: t.text });
        remaining = 0;
      }
    }
  }

  const totalTokens =
    projectSlice.estimatedTokens + modulesSlice.estimatedTokens + memoriesSlice.estimatedTokens;

  // ── Decay warnings ─────────────────────────────────────────────────────
  const decayWarnings: string[] = [];
  for (const m of trimmedMemories) {
    const u = getUsage(usage, m.id);
    const loaded = byId.get(m.id);
    const createdAt = loaded?.memory.frontmatter.created_at ?? new Date().toISOString();
    if (isDecaying(u, createdAt)) decayWarnings.push(m.id);
  }

  // ── Format + priority + why ────────────────────────────────────────────
  const formattedMemories =
    input.format === "compact"
      ? trimmedMemories.map((m) => ({ ...m, body: compactSummary(m.body) }))
      : input.format === "actions"
        ? trimmedMemories.map((m) => ({ ...m, body: extractActionsBriefBody(m.body) }))
        : trimmedMemories;

  const outputMemories = formattedMemories.map((m) => ({
    ...m,
    priority: classifyMemoryPriority(m, byId.get(m.id), input.files, input.symbols),
    why: explainWhySurfaced(m, byId.get(m.id), input.files, inferred),
  }));

  const briefingQuality = classifyBriefingQuality(outputMemories, {
    isTemplateContext,
    autoContextGenerated,
    hasLastSession: Boolean(lastSession),
    searchMode,
  });

  // ── Code-map symbol lookup ─────────────────────────────────────────────
  let symbolLocations: BriefingOutput["symbol_locations"];
  const symbolsToLookup = new Set<string>(input.symbols);
  for (const m of outputMemories) {
    for (const sym of byId.get(m.id)?.memory.frontmatter.anchor.symbols ?? []) {
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

  // ── action_required ────────────────────────────────────────────────────
  const actionRequired: ActionRequiredItem[] = [];

  const extractActionItem = (id: string, body: string): ActionRequiredItem => {
    const bodyLines = body.split("\n");
    const quoteBlock = bodyLines
      .filter((l) => l.startsWith("> "))
      .map((l) => l.slice(2))
      .join(" ")
      .replace(/^\*«\s*/, "")
      .replace(/\s*»\*$/, "")
      .trim();
    const headingLine = bodyLines.find((l) => l.startsWith("## "));
    const summary = headingLine?.replace(/^##\s*/, "").trim() ?? id;
    return {
      id,
      summary,
      developer_message: quoteBlock ||
        `A potentially incompatible external change was detected (${id}). ` +
        `Do you want me to analyze the impact and propose updates?`,
    };
  };

  for (const m of outputMemories) {
    const loaded = byId.get(m.id);
    if (loaded?.memory.frontmatter.requires_human_approval) {
      actionRequired.push(extractActionItem(m.id, loaded.memory.body));
    }
  }
  if (existsSync(ctx.paths.memoriesDir)) {
    const allMems = await loadMemoriesFromDir(ctx.paths.memoriesDir);
    for (const { memory } of allMems) {
      const fm = memory.frontmatter;
      if (!fm.requires_human_approval) continue;
      if (fm.status === "rejected" || fm.status === "deprecated") continue;
      if (actionRequired.some((a) => a.id === fm.id)) continue;
      actionRequired.push(extractActionItem(fm.id, memory.body));
    }
  }

  // ── Pending distill ────────────────────────────────────────────────────
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
        try {
          const { rm } = await import("node:fs/promises");
          await rm(pendingDistillFile);
        } catch { /* non-fatal */ }
      }
    } catch { /* malformed or deleted between check and read — skip */ }
  }

  // ── low_value + adaptive trim + hints ─────────────────────────────────
  const memoriesEmpty = outputMemories.length === 0;
  const hasMemoriesDir = existsSync(ctx.paths.memoriesDir);
  const isColdStart = isTemplateContext && memoriesEmpty && !lastSession && !autoContextGenerated;

  const hasUnguessableSignal = outputMemories.some(
    (m) =>
      (m.priority === "must_read" || m.priority === "useful") &&
      specificityScore(m.body) >= GUESSABLE_THRESHOLD,
  );
  const briefingValueLow = !hasUnguessableSignal;
  const adaptiveConfig = await loadConfig(ctx.paths);
  const bootstrapUnfilled =
    /Auto-generated by `haive init/i.test(projectContextRaw) &&
    (projectContextRaw.match(/TODO —/g)?.length ?? 0) >= 2;
  const contextIsInferable = isTemplateContext || autoContextGenerated || bootstrapUnfilled;
  const adaptiveTrim =
    adaptiveConfig.adaptiveBriefing !== false && briefingValueLow && contextIsInferable;

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
      hints.push(
        "After completing the task: capture new gotchas with mem_observe, " +
        "failed approaches with mem_tried, validated patterns with mem_save.",
      );
    }
    if (
      outputMemories.length > 2 &&
      !input.budget_preset &&
      input.task &&
      !hints.some((h) => h.includes("budget_preset"))
    ) {
      hints.push(
        "For tighter token budgets on small tasks pass budget_preset:'quick'; " +
        "for refactor-sized work use budget_preset:'deep'.",
      );
    }
  }
  if (adaptiveTrim) {
    hints.push(
      "No team-specific policy matched these files/task — nothing here a capable model can't " +
      "infer. The auto-generated project context was trimmed to keep this briefing near-zero-cost; " +
      "proceed with normal Read/Grep.",
    );
  }

  // ── C5 TODO: briefingProofLine() hook (Lot B) ─────────────────────────
  // When Lot B exposes `briefingProofLine(events): string | null` from @hiveai/core,
  // import it here and append the returned string to `hints` (if non-null).
  // Expected signature (coordinate via PR):
  //   briefingProofLine(preventionEvents: PreventionEvent[], since?: Date): string | null
  // Example output: "hAIve prevented 3 repeated mistakes this month."
  // Insert it as: if (!isColdStart) { const line = briefingProofLine(...); if (line) hints.push(line); }

  // ── Briefing marker (satisfies enforcement gate for MCP-native agents) ─
  if (existsSync(ctx.paths.haiveDir)) {
    await writeBriefingMarker(ctx.paths, {
      sessionId: process.env.HAIVE_SESSION_ID,
      ...(input.task ? { task: input.task } : {}),
      source: "mcp-get-briefing",
      files: input.files,
      memoryIds: outputMemories.map((m) => m.id),
    }).catch(() => { /* marker is best-effort — never fail the briefing on it */ });
  }

  return {
    ...(input.task ? { task: input.task } : {}),
    search_mode: searchMode,
    inferred_modules: inferred,
    ...(lastSession ? { last_session: lastSession } : {}),
    project_context: contextOmittedRecent
      ? {
          content:
            "(project context unchanged — omitted to save tokens; it was provided earlier this " +
            "session. Pass dedupe_project_context:false to force a full copy.)",
          truncated: false,
          omitted_recent: true,
        }
      : adaptiveTrim
      ? {
          content:
            "(adaptive briefing: auto-generated context omitted — no team-specific policy " +
            "matched, so a capable model needs nothing extra here)",
          truncated: false,
          ...(isTemplateContext && !autoContextGenerated ? { is_template: true } : {}),
          ...(autoContextGenerated ? { auto_generated: true } : {}),
        }
      : (projectContextRaw || autoContextGenerated)
        ? {
            content: projectSlice.text,
            truncated: projectSlice.truncated,
            ...(isTemplateContext && !autoContextGenerated ? { is_template: true } : {}),
            ...(autoContextGenerated ? { auto_generated: true } : {}),
          }
        : null,
    module_contexts: trimmedModules,
    memories: outputMemories,
    briefing_quality: briefingQuality,
    ...(symbolLocations ? { symbol_locations: symbolLocations } : {}),
    action_required: actionRequired,
    decay_warnings: decayWarnings,
    setup_warnings: setupWarnings,
    ...(isColdStart ? { low_value: true as const } : {}),
    briefing_value: briefingValueLow ? "low" : "high",
    ...(hints.length > 0 ? { hints } : {}),
    estimated_tokens: totalTokens,
    budget: {
      max_tokens: briefingMaxTokens,
      ...(input.budget_preset ? { preset_applied: input.budget_preset } : {}),
      spent: {
        project: projectSlice.estimatedTokens,
        modules: modulesSlice.estimatedTokens,
        memories: memoriesSlice.estimatedTokens,
      },
    },
  };
}
