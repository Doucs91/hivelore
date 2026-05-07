import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  extractActionsBriefBody,
  findProjectRoot,
  literalMatchesAllTokens,
  literalMatchesAnyToken,
  loadCodeMap,
  loadMemoriesFromDir,
  loadUsageIndex,
  memoryMatchesAnchorPaths,
  queryCodeMap,
  resolveBriefingBudget,
  resolveHaivePaths,
  tokenizeQuery,
  trackReads,
  writeBriefingMarker,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";
import { buildRadar, radarHasContent, type RadarReport } from "../utils/briefing-radar.js";

interface BriefingOptions {
  task?: string;
  files?: string;
  symbols?: string;
  maxMemories?: string;
  maxTokens?: string;
  explainSource?: boolean;
  scope?: string;
  includeDraft?: boolean;
  includeStale?: boolean;
  dir?: string;
  include?: string[];
  radar?: boolean;
  /** quick | balanced | deep — aligns with get_briefing budget_preset */
  budget?: string;
  /** full | actions — mimic get_briefing format for printed bodies */
  memoryFormat?: string;
}

const RADAR_AUTO_THRESHOLD = 3;

const CHARS_PER_TOKEN = 4;

function printRadar(
  radar: RadarReport,
  out: (text: string) => boolean,
  reason: "low-memory-signal" | "forced",
): void {
  if (!radar.insideGitRepo) return;
  if (!radarHasContent(radar)) return;
  const header = reason === "low-memory-signal"
    ? "=== Project Radar (few relevant memories — surfacing live signals) ==="
    : "=== Project Radar ===";
  out(`${ui.bold(header)}\n`);

  if (radar.recentCommits.length > 0) {
    out(ui.bold("Recent commits:"));
    for (const c of radar.recentCommits) {
      const filesBlurb = c.files.slice(0, 3).join(", ");
      const more = c.files.length > 3 ? ` (+${c.files.length - 3})` : "";
      out(`  ${ui.dim(c.date)} ${c.sha}  ${c.subject}`);
      if (filesBlurb) out(ui.dim(`    ${filesBlurb}${more}`));
    }
    out("");
  }
  if (radar.openTodos.length > 0) {
    out(ui.bold("Open TODOs/FIXMEs:"));
    for (const t of radar.openTodos) {
      out(`  ${ui.dim(t.file + ":" + t.line)}  ${t.text}`);
    }
    out("");
  }
  if (radar.hotFiles.length > 0) {
    out(ui.bold("Hot files (most modified recently):"));
    for (const f of radar.hotFiles) {
      out(`  ${f.changes}× ${ui.dim(f.path)}`);
    }
    out("");
  }
}

class TokenBudgetWriter {
  private used = 0;
  private truncated = false;
  constructor(private readonly budgetChars: number) {}
  write(text: string): boolean {
    if (this.truncated) return false;
    const next = this.used + text.length + 1;
    if (next > this.budgetChars) {
      console.log(ui.dim(`... [briefing truncated to fit --max-tokens budget · ${Math.round(this.used / CHARS_PER_TOKEN)} tokens used]`));
      this.truncated = true;
      return false;
    }
    console.log(text);
    this.used = next;
    return true;
  }
  isTruncated(): boolean { return this.truncated; }
  remainingChars(): number { return Math.max(0, this.budgetChars - this.used); }
}

export function registerBriefing(program: Command): void {
  program
    .command("briefing")
    .description(
      "Print the full project briefing: last session recap + project context + relevant memories.\n" +
      "  Equivalent to calling get_briefing via MCP. Run before starting any task.\n\n" +
      "  Examples:\n" +
      "    haive briefing\n" +
      "    haive briefing --task \"add Stripe payment\" --files src/payments/PaymentService.ts\n" +
      "    haive briefing --budget quick --task \"tiny fix\"\n",
    )
    .option("--task <text>", "what you are about to do — filters memories by relevance")
    .option("--files <csv>", "comma-separated file paths being worked on (surfaces anchored memories)")
    .option("--symbols <csv>", "symbol names to look up in the code-map (e.g. PaymentService,TenantFilter) — requires haive index code")
    .option("--max-memories <n>", "cap on memories surfaced", "10")
    .option("--max-tokens <n>", "approximate token budget for the entire briefing (truncates if exceeded)")
    .option("--explain-source", "annotate each memory with [source: <relative-path> · anchors: <files>] for traceable citations")
    .option("--radar", "force project radar (recent commits, open TODOs, hot files) even when memories are plentiful")
    .option("--no-radar", "disable the project radar even when memories are scarce")
    .option(
      "--budget <preset>",
      "align with MCP get_briefing budget_preset: quick | balanced | deep — sets cap + truncation budget (overrides --max-memories / replaces default open-ended output)",
      undefined,
    )
    .option(
      "--memory-format <mode>",
      "printed memory bodies: full (default) | actions (cheap bullet-focused excerpt)",
      "full",
    )
    .option(
      "--scope <scope>",
      "personal | team | shared | all (default: all — includes team + shared cross-repo memories)",
      "all",
    )
    .option("--include-draft", "include draft memories (excluded by default)")
    .option("--include-stale", "include stale memories (excluded by default — may be outdated)")
    .option(
      "--include <path>",
      "merge memories from another haive-initialized project (repeatable). " +
      "Useful for teams with multiple coordinated repos (e.g. backend + frontend).",
      collectInclude,
      [] as string[],
    )
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: BriefingOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (existsSync(paths.haiveDir)) {
        await mkdir(paths.runtimeDir, { recursive: true });
        await writeBriefingMarker(paths, {
          task: opts.task ?? "CLI briefing",
          source: "haive-briefing-cli",
          sessionId: process.env.HAIVE_SESSION_ID,
        }).catch(() => { /* marker is best-effort */ });
      }

      type BB = "quick" | "balanced" | "deep";
      let budgetPreset: BB | null = null;
      if (opts.budget) {
        const b = opts.budget.trim().toLowerCase();
        if (b === "quick" || b === "balanced" || b === "deep") budgetPreset = b;
        else ui.warn(`Unknown --budget '${opts.budget}' — ignoring (use quick|balanced|deep).`);
      }

      let maxMemories = Math.max(1, Number(opts.maxMemories ?? 10));
      let budgetTokensCap: number | null = opts.maxTokens ? Math.max(100, Number(opts.maxTokens)) : null;

      if (budgetPreset !== null) {
        const presetNums = resolveBriefingBudget(budgetPreset, {
          max_tokens: 8000,
          max_memories: 8,
          include_module_contexts: true,
        });
        budgetTokensCap = presetNums.max_tokens;
        maxMemories = presetNums.max_memories;
      }

      const writer = budgetTokensCap !== null ? new TokenBudgetWriter(budgetTokensCap * CHARS_PER_TOKEN) : null;
      const out = (text: string): boolean => {
        if (writer) return writer.write(text);
        console.log(text);
        return true;
      };
      const stopped = (): boolean => writer?.isTruncated() ?? false;

      if (!existsSync(paths.memoriesDir)) {
        // No memories yet — print project context (if any) + radar fallback
        if (existsSync(paths.projectContext)) {
          out(`${ui.bold("=== Project Context ===")}\n`);
          out((await readFile(paths.projectContext, "utf8")).trim());
          out("");
        } else {
          ui.warn("No project-context.md found. Run `haive init` and the `bootstrap_project` MCP prompt to set it up.");
        }
        if (opts.radar !== false && !stopped()) {
          const filePathsEarly = parseCsv(opts.files);
          const tokensEarly = opts.task ? tokenizeQuery(opts.task) : null;
          const radar = await buildRadar({ root, taskTokens: tokensEarly, filePaths: filePathsEarly });
          printRadar(radar, out, "low-memory-signal");
        }
        return;
      }

      type LoadedWithOrigin = Awaited<ReturnType<typeof loadMemoriesFromDir>>[number] & { origin?: string };
      const ownMemories: LoadedWithOrigin[] = await loadMemoriesFromDir(paths.memoriesDir);

      // Multi-project aggregation: merge memories from --include <path> projects.
      const externalRoots: string[] = [];
      if (opts.include && opts.include.length > 0) {
        for (const includePath of opts.include) {
          try {
            const otherRoot = findProjectRoot(includePath);
            if (otherRoot === root) continue; // skip self
            const otherPaths = resolveHaivePaths(otherRoot);
            if (!existsSync(otherPaths.memoriesDir)) {
              ui.warn(`--include ${includePath}: no .ai/memories at ${otherRoot} — skipping`);
              continue;
            }
            const otherMemories = await loadMemoriesFromDir(otherPaths.memoriesDir);
            const tag = path.basename(otherRoot);
            for (const m of otherMemories) {
              ownMemories.push({ ...m, origin: tag });
            }
            externalRoots.push(`${tag} (${otherMemories.length})`);
          } catch (err) {
            ui.warn(`--include ${includePath}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        if (externalRoots.length > 0) {
          ui.info(`merged from: ${externalRoots.join(", ")}`);
          console.log();
        }
      }

      const all = ownMemories;
      const filePaths = parseCsv(opts.files);
      const tokens = opts.task ? tokenizeQuery(opts.task) : null;
      const scopeFilter = opts.scope ?? "all";

      // ── 1. Session recap — always shown first so agents start with fresh context ──
      const recaps = all
        .filter(({ memory: mem }) => mem.frontmatter.type === "session_recap")
        .sort((a, b) =>
          new Date(b.memory.frontmatter.created_at).getTime() -
          new Date(a.memory.frontmatter.created_at).getTime(),
        );
      if (recaps.length > 0 && !stopped()) {
        const recap = recaps[0]!;
        const fm = recap.memory.frontmatter;
        const rev = fm.revision_count ? ` · revision #${fm.revision_count}` : "";
        out(`${ui.bold("=== Last Session Recap ===")}\n`);
        out(ui.dim(`${fm.id} (${fm.scope}${rev})`));
        out(recap.memory.body.trim());
        out("");
      }

      // ── 2. Project context ─────────────────────────────────────────────────────
      if (existsSync(paths.projectContext) && !stopped()) {
        const ctx = await readFile(paths.projectContext, "utf8");
        const isTemplate = ctx.includes("TODO — high-level overview") || ctx.includes("Generated by `haive init`");
        if (isTemplate) {
          ui.warn(
            "project-context.md still contains the default template — get_briefing will return little value.",
          );
          ui.warn(
            "Fix: in your AI client, invoke the MCP prompt bootstrap_project to auto-fill it from your codebase.",
          );
          out("");
        } else {
          out(`${ui.bold("=== Project Context ===")}\n`);
          out(ctx.trim());
          out("");
        }
      } else if (!existsSync(paths.projectContext)) {
        ui.warn(
          "No project-context.md found. Run `haive init` then invoke the bootstrap_project MCP prompt.",
        );
      }

      // Filter: exclude noise, drafts, stale, and session_recap (shown above) by default
      const candidates = all.filter(({ memory: mem }) => {
        const fm = mem.frontmatter;
        if (fm.status === "rejected" || fm.status === "deprecated") return false;
        if (!opts.includeDraft && fm.status === "draft") return false;
        if (!opts.includeStale && fm.status === "stale") return false;
        if (scopeFilter !== "all" && fm.scope !== scopeFilter && !(scopeFilter === "team" && fm.scope === "shared")) return false;
        if (fm.type === "session_recap") return false; // shown separately above
        return true;
      });

      // Score by relevance (AND on task tokens; OR fallback if AND produces no task hits)
      const andTaskHits = tokens
        ? new Set(candidates.filter(({ memory: mem }) => literalMatchesAllTokens(mem, tokens)).map(({ memory: mem }) => mem.frontmatter.id))
        : null;
      const useOrFallback = andTaskHits !== null && andTaskHits.size === 0 && (tokens?.length ?? 0) > 1;

      const scored = candidates.map(({ memory: mem, filePath }) => {
        const fm = mem.frontmatter;
        let score = 0;
        if (fm.status === "validated") score += 3;
        else if (fm.status === "proposed") score += 1;
        if (filePaths.length > 0 && memoryMatchesAnchorPaths(mem, filePaths)) score += 4;
        if (tokens) {
          if (andTaskHits?.has(fm.id)) score += 3;
          else if (useOrFallback && literalMatchesAnyToken(mem, tokens)) score += 1;
        }
        return { memory: mem, filePath, score };
      });

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, maxMemories);

      if (top.length === 0) {
        ui.info("No relevant memories found.");
        const draftCount = all.filter(
          (m) =>
            m.memory.frontmatter.status === "draft" &&
            (scopeFilter === "all" || m.memory.frontmatter.scope === scopeFilter),
        ).length;
        if (draftCount > 0) {
          ui.info(`(${draftCount} draft memories excluded — use --include-draft to show)`);
        }
        if (opts.radar !== false && !stopped()) {
          const radar = await buildRadar({ root, taskTokens: tokens, filePaths });
          out("");
          printRadar(radar, out, "low-memory-signal");
        }
        return;
      }

      if (stopped()) return;
      const usageIndex = await loadUsageIndex(paths).catch(() => null);
      out(`${ui.bold("=== Relevant Memories ===")}\n`);
      for (const item of top) {
        if (stopped()) break;
        const fm = item.memory.frontmatter;
        const badge = ui.statusBadge(fm.status);
        const draftMarker = fm.status === "draft" ? ui.yellow(" [DRAFT]") : "";
        const unverifiedMarker = fm.status === "proposed" ? ui.yellow(" [UNVERIFIED]") : "";
        const originMarker = (item as LoadedWithOrigin).origin
          ? ` ${ui.yellow("[from " + (item as LoadedWithOrigin).origin + "]")}`
          : "";
        const reads = usageIndex?.by_id[fm.id]?.read_count ?? 0;
        const hitMarker = reads > 0 ? ` ${ui.dim("· " + reads + "× read")}` : "";
        out(
          `${ui.bold(fm.id)}  ${ui.dim(fm.scope + "/" + fm.type)}  ${badge}${draftMarker}${unverifiedMarker}${originMarker}${hitMarker}`,
        );
        if (opts.explainSource) {
          const relPath = path.relative(root, item.filePath);
          const anchorPaths = fm.anchor?.paths ?? [];
          const anchorSymbols = fm.anchor?.symbols ?? [];
          const parts: string[] = [`source: ${relPath}`];
          if (anchorPaths.length > 0) parts.push(`paths: ${anchorPaths.join(", ")}`);
          if (anchorSymbols.length > 0) parts.push(`symbols: ${anchorSymbols.join(", ")}`);
          out(ui.dim(`  [${parts.join(" · ")}]`));
        }
        const memBody =
          opts.memoryFormat?.toLowerCase() === "actions"
            ? extractActionsBriefBody(item.memory.body)
            : item.memory.body.trim();
        out(memBody);
        out("");
      }
      if (!stopped()) out(ui.dim(`${top.length} memor${top.length === 1 ? "y" : "ies"} surfaced`));

      // Track reads so usage stats, decay, and hot-memory detection work via CLI too
      const ids = top.map(({ memory: mem }) => mem.frontmatter.id);
      if (ids.length > 0) {
        await trackReads(paths, ids).catch(() => { /* non-fatal */ });
      }

      // ── Project radar — surface git/TODO/hot-file signals when memories are scarce ──
      const radarForced = opts.radar === true;
      const radarAuto = opts.radar !== false && top.length < RADAR_AUTO_THRESHOLD;
      if ((radarForced || radarAuto) && !stopped()) {
        const radar = await buildRadar({ root, taskTokens: tokens, filePaths });
        if (radarHasContent(radar)) {
          out("");
          printRadar(radar, out, radarForced ? "forced" : "low-memory-signal");
        }
      }

      // ── Code-map symbol lookup ──────────────────────────────────────────
      const requestedSymbols = (opts.symbols ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (requestedSymbols.length > 0 && !stopped()) {
        const codeMap = await loadCodeMap(paths);
        if (!codeMap) {
          ui.warn("No code-map found. Run `haive index code` first to enable symbol lookup.");
        } else {
          out(`\n${ui.bold("=== Symbol Locations ===")}\n`);
          for (const sym of requestedSymbols) {
            if (stopped()) break;
            const { files } = queryCodeMap(codeMap, { symbol: sym });
            if (files.length === 0) {
              out(`${ui.dim(sym)}  (not found in code-map)`);
            } else {
              for (const f of files) {
                if (stopped()) break;
                const exports = f.entry.exports.filter((e) =>
                  e.name.toLowerCase().includes(sym.toLowerCase()),
                );
                for (const e of exports) {
                  if (stopped()) break;
                  const desc = e.description ? `  — ${e.description}` : "";
                  out(`${ui.bold(e.name)}  ${ui.dim(f.path + ":" + e.line)}  [${e.kind}]${desc}`);
                }
              }
            }
          }
          out("");
        }
      }
    });
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function collectInclude(value: string, previous: string[]): string[] {
  return [...previous, value];
}
