import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { isEnvWorkaroundMemory, isGlobPath, isStackPackSeed, pathsOverlap } from "@hiveai/core";
import type { LoadedMemory } from "@hiveai/core";
import type { HaiveContext } from "../context.js";
import type {
  BriefingMemory,
  BriefingMemoryPriority,
  BriefingOutput,
  BriefingQuality,
} from "./briefing-types.js";

export function compactSummary(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.replace(/^#+\s*/, "").trim();
    if (trimmed.length > 0) return trimmed.slice(0, 120);
  }
  return body.slice(0, 120);
}

export function classifyMemoryPriority(
  memory: BriefingMemory,
  loaded: LoadedMemory | undefined,
  inputFiles: string[],
  inputSymbols: string[],
): BriefingMemoryPriority {
  const fm = loaded?.memory.frontmatter;
  const directAnchor = Boolean(
    fm && inputFiles.length > 0 &&
    fm.anchor.paths.some((p) => inputFiles.some((file) => pathsOverlap(p, file))),
  );
  const directSymbol = Boolean(
    fm && inputSymbols.length > 0 &&
    fm.anchor.symbols.some((sym) =>
      inputSymbols.some((wanted) => wanted.toLowerCase() === sym.toLowerCase()),
    ),
  );
  const strongSemantic = (memory.semantic_score ?? 0) >= 0.65;
  const usefulSemantic = (memory.semantic_score ?? 0) >= 0.35;

  if (
    fm?.requires_human_approval ||
    directAnchor ||
    directSymbol ||
    (memory.type === "attempt" && (memory.match_quality === "exact" || strongSemantic)) ||
    (memory.type === "skill" && (memory.match_quality === "exact" || strongSemantic))
  ) {
    return "must_read";
  }

  // Generic stack-pack seeds never claim `useful` rank on a semantic/tag match alone —
  // they would otherwise crowd out repo-specific memories.
  if (isStackPackSeed(fm)) {
    return "background";
  }

  // Local dev-environment workarounds (hot-swap, nested node_modules, …) are tooling debt, not
  // team policy. They get read constantly so their read_count inflates the corpus and crowds the
  // briefing. Cap them at `background` unless they directly anchor a file being edited (handled by
  // the must_read branch above) — so real policy keeps the top slots.
  if (isEnvWorkaroundMemory(fm)) {
    return "background";
  }

  if (
    memory.type === "skill" ||
    memory.reasons.includes("module") ||
    memory.reasons.includes("domain") ||
    memory.match_quality === "exact" ||
    usefulSemantic
  ) {
    return "useful";
  }

  return "background";
}

export function priorityRank(priority: BriefingMemoryPriority): number {
  return priority === "must_read" ? 3 : priority === "useful" ? 2 : 1;
}

export function classifyBriefingQuality(
  memories: BriefingMemory[],
  context: {
    isTemplateContext: boolean;
    autoContextGenerated: boolean;
    hasLastSession: boolean;
    searchMode: BriefingOutput["search_mode"];
  },
): BriefingQuality {
  const mustRead = memories.filter((m) => m.priority === "must_read").length;
  const useful = memories.filter((m) => m.priority === "useful").length;
  const background = memories.filter((m) => m.priority === "background").length;
  const weakSemantic = memories.filter((m) =>
    m.reasons.length === 1 &&
    m.reasons.includes("semantic") &&
    (m.semantic_score ?? 0) > 0 &&
    (m.semantic_score ?? 0) < 0.35,
  ).length;
  const reasons: string[] = [];

  if (memories.length === 0) reasons.push("no memories matched the task or files");
  if (context.isTemplateContext && !context.autoContextGenerated) reasons.push("project context is still a template");
  if (!context.hasLastSession) reasons.push("no previous session recap");
  if (mustRead > 0) reasons.push(`${mustRead} must_read memor${mustRead === 1 ? "y" : "ies"} matched directly`);
  if (useful > 0) reasons.push(`${useful} useful memor${useful === 1 ? "y" : "ies"} matched`);
  if (background > useful + mustRead && background > 2) reasons.push(`${background} background memories dominate the result`);
  if (weakSemantic > 0) reasons.push(`${weakSemantic} weak semantic-only match${weakSemantic === 1 ? "" : "es"}`);
  if (context.searchMode === "literal_fallback") reasons.push("semantic index unavailable or empty; literal fallback used");

  if (memories.length === 0 || (mustRead === 0 && useful === 0)) {
    return { level: "thin", reasons };
  }
  if (background > useful + mustRead && background > 2) {
    return { level: "noisy", reasons };
  }
  return { level: "strong", reasons };
}

export function explainWhySurfaced(
  memory: BriefingMemory,
  loaded: LoadedMemory | undefined,
  inputFiles: string[],
  inferredModules: string[],
): string[] {
  const why: string[] = [];
  const fm = loaded?.memory.frontmatter;
  if (memory.reasons.includes("anchor") && fm) {
    const matching = fm.anchor.paths.filter((p) =>
      inputFiles.length === 0 || inputFiles.some((file) => pathsOverlap(p, file)),
    );
    if (matching.length > 0) {
      const exact = matching.filter((p) =>
        !isGlobPath(p) && inputFiles.some((file) => p === file || pathsOverlap(p, file)),
      );
      const glob = matching.filter((p) => isGlobPath(p));
      if (exact.length > 0) {
        why.push(`Exact/file anchor match: ${exact.slice(0, 4).join(", ")}`);
      }
      if (glob.length > 0) {
        why.push(`Glob anchor match: ${glob.slice(0, 4).join(", ")}`);
      }
      if (exact.length === 0 && glob.length === 0) {
        why.push(`Anchored to touched path${matching.length === 1 ? "" : "s"}: ${matching.slice(0, 4).join(", ")}`);
      }
    } else if (fm.anchor.paths.length > 0) {
      why.push(`Pulled by related anchor: ${fm.anchor.paths.slice(0, 4).join(", ")}`);
    }
    if (fm.anchor.symbols.length > 0) {
      why.push(`Anchor symbol${fm.anchor.symbols.length === 1 ? "" : "s"}: ${fm.anchor.symbols.slice(0, 4).join(", ")}`);
    }
  }
  if (memory.reasons.includes("symbol") && fm) {
    why.push(`Explicit symbol match: ${fm.anchor.symbols.slice(0, 4).join(", ")}`);
  }
  if (memory.reasons.includes("module")) {
    const moduleHints = [
      ...(memory.module ? [memory.module] : []),
      ...memory.tags.filter((tag) => inferredModules.includes(tag)),
    ];
    const shown = moduleHints.length > 0 ? [...new Set(moduleHints)].join(", ") : inferredModules.join(", ");
    why.push(shown ? `Matched inferred module/tag: ${shown}` : "Matched inferred module context.");
  }
  if (memory.reasons.includes("domain")) {
    why.push("Matched inferred domain from the target file paths.");
  }
  if (memory.reasons.includes("semantic")) {
    const score = memory.semantic_score !== undefined
      ? ` score=${Math.round(memory.semantic_score * 100) / 100}`
      : "";
    why.push(`${memory.match_quality === "exact" ? "Literal task match" : "Semantic/task relevance"}${score}.`);
  }
  why.push(`Confidence: ${memory.confidence}; read ${memory.read_count} time${memory.read_count === 1 ? "" : "s"}.`);
  if (memory.type === "attempt") why.push("Failed-approach record; read before repeating the same path.");
  if (memory.type === "skill") why.push("Skill (reusable procedure/playbook) — follow the steps described when doing this type of task.");
  if (memory.status === "proposed" || memory.status === "draft") {
    why.push("Unvalidated record; use cautiously or ask a human before treating it as policy.");
  }
  return why;
}

export async function trySemanticHits(
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

export async function loadModuleContexts(
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
