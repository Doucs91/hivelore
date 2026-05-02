import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import {
  aggregateUsage,
  buildFrontmatter,
  findProjectRoot,
  loadMemoriesFromDir,
  memoryFilePath,
  parseSince,
  readUsageEvents,
  resolveHaivePaths,
  serializeMemory,
} from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface SuggestOptions {
  since?: string;
  min?: string;
  json?: boolean;
  dir?: string;
  autoSave?: boolean;
  topN?: string;
  scope?: "personal" | "team";
}

const SEARCH_TOOLS = new Set([
  "mem_search",
  "code_search",
  "mem_relevant_to",
  "get_briefing",
]);

interface QuerySuggestion {
  query: string;
  count: number;
  tools: string[];
  last_used: string;
  reason: string;
  inferred_type: "architecture" | "convention" | "decision" | "gotcha";
}

export function registerMemorySuggest(memory: Command): void {
  memory
    .command("suggest")
    .description(
      "Suggest memories to create based on recurring search queries in the usage log.\n\n" +
      "  Use --auto-save to draft the top-N suggestions as draft memories. They land\n" +
      "  in personal scope by default with status=draft, ready for you to edit and promote.",
    )
    .option("--since <window>", "ISO date or relative (e.g. '7d', '24h')", "30d")
    .option("--min <count>", "minimum repeat count to surface a query", "2")
    .option("--top-n <n>", "with --auto-save, draft this many top suggestions", "3")
    .option("--scope <scope>", "with --auto-save, scope of drafted memories (personal | team)", "personal")
    .option("--auto-save", "draft top-N suggestions as draft memories on disk", false)
    .option("--json", "emit JSON instead of human-readable output", false)
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SuggestOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const events = await readUsageEvents(paths);
      if (events.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ suggestions: [] }));
          return;
        }
        ui.warn("No usage log entries yet. Suggestions appear after the MCP server records some calls.");
        return;
      }

      const since = parseSince(opts.since);
      const minCount = Math.max(1, parseInt(opts.min ?? "2", 10));
      const cutoff = since ? since.getTime() : 0;

      const queries = new Map<string, { count: number; tools: Set<string>; last: string }>();
      for (const e of events) {
        if (cutoff && Date.parse(e.at) < cutoff) continue;
        if (!SEARCH_TOOLS.has(e.tool)) continue;
        const key = (e.summary ?? "").toLowerCase().trim();
        if (!key) continue;
        const prior = queries.get(key);
        if (prior) {
          prior.count++;
          prior.tools.add(e.tool);
          if (e.at > prior.last) prior.last = e.at;
        } else {
          queries.set(key, { count: 1, tools: new Set([e.tool]), last: e.at });
        }
      }

      const suggestions: QuerySuggestion[] = [...queries.entries()]
        .filter(([, v]) => v.count >= minCount)
        .map(([query, v]) => ({
          query,
          count: v.count,
          tools: [...v.tools].sort(),
          last_used: v.last,
          reason: chooseReason(v.tools, v.count),
          inferred_type: inferType(v.tools, query),
        }))
        .sort((a, b) => b.count - a.count);

      // ── Auto-save flow ────────────────────────────────────────────────────
      if (opts.autoSave) {
        const topN = Math.max(1, parseInt(opts.topN ?? "3", 10));
        const scope: "personal" | "team" = opts.scope === "team" ? "team" : "personal";
        const top = suggestions.slice(0, topN);
        if (top.length === 0) {
          ui.warn(`No suggestions met --min=${minCount} — nothing to draft.`);
          return;
        }
        const created: Array<{ id: string; file: string; query: string }> = [];
        const skipped: Array<{ query: string; reason: string }> = [];
        const existing = existsSync(paths.memoriesDir)
          ? await loadMemoriesFromDir(paths.memoriesDir)
          : [];

        for (const s of top) {
          const slug = slugify(s.query);
          if (!slug) {
            skipped.push({ query: s.query, reason: "could not derive a slug" });
            continue;
          }
          // Avoid overwriting an existing memory with similar slug.
          const dup = existing.find(({ memory }) => memory.frontmatter.id.endsWith(`-${slug}`));
          if (dup) {
            skipped.push({ query: s.query, reason: `similar memory already exists (${dup.memory.frontmatter.id})` });
            continue;
          }
          const fm = buildFrontmatter({
            type: s.inferred_type,
            slug,
            scope,
            tags: ["auto-suggested", ...s.tools],
            paths: [],
            symbols: [],
          });
          // Drafts wait for human review.
          fm.status = "draft";
          const body = renderTemplate(s);
          const file = memoryFilePath(paths, fm.scope, fm.id, fm.module);
          await mkdir(path.dirname(file), { recursive: true });
          if (existsSync(file)) {
            skipped.push({ query: s.query, reason: `file already exists at ${path.relative(root, file)}` });
            continue;
          }
          await writeFile(file, serializeMemory({ frontmatter: fm, body }), "utf8");
          created.push({ id: fm.id, file: path.relative(root, file), query: s.query });
        }

        if (opts.json) {
          console.log(JSON.stringify({ created, skipped }, null, 2));
          return;
        }
        for (const c of created) {
          ui.success(`Drafted ${c.id} → ${c.file}`);
          console.log(`     ${ui.dim("from query:")} ${truncate(c.query, 60)}`);
        }
        for (const s of skipped) {
          ui.warn(`Skipped: ${truncate(s.query, 50)} — ${s.reason}`);
        }
        if (created.length > 0) {
          console.log();
          ui.info("Drafts are status=draft — edit them, then `haive memory promote` to validate.");
        }
        return;
      }

      // ── Read-only listing flow ───────────────────────────────────────────
      if (opts.json) {
        console.log(JSON.stringify({ window: opts.since, suggestions }, null, 2));
        return;
      }

      const totals = aggregateUsage(events, since ?? undefined);
      console.log(ui.bold(`hAIve memory suggestions (${opts.since ?? "all time"})`));
      console.log(
        ui.dim(`scanned ${totals.total} events, ${suggestions.length} repeated queries (≥${minCount})`),
      );
      console.log();
      if (suggestions.length === 0) {
        ui.info("No recurring searches yet — nothing to suggest.");
        return;
      }
      for (const s of suggestions.slice(0, 30)) {
        console.log(
          `  ${ui.bold(`×${s.count}`)} ${ui.dim(`[${s.tools.join(",")}]`)}  ${truncate(s.query, 70)}`,
        );
        console.log(`     ${ui.dim("→")} ${s.reason}`);
      }
      console.log();
      ui.info("Run with --auto-save to draft the top-3 as draft memories.");
    });
}

function chooseReason(tools: Set<string>, count: number): string {
  if (tools.has("code_search")) {
    return `${count} agents searched the code for this — consider mem_save (architecture/decision) capturing where it lives.`;
  }
  if (tools.has("mem_search") || tools.has("mem_relevant_to")) {
    return `${count} agents asked but the memory layer had no clear answer — consider mem_save (convention/decision/gotcha).`;
  }
  return `${count} agents asked the briefing for this — consider promoting the answer to a team memory.`;
}

function inferType(tools: Set<string>, query: string): QuerySuggestion["inferred_type"] {
  const q = query.toLowerCase();
  if (q.includes("bug") || q.includes("error") || q.includes("crash") || q.includes("trap")) return "gotcha";
  if (q.includes("decid") || q.includes("why") || q.includes("choose") || q.includes("vs ")) return "decision";
  if (tools.has("code_search") && (q.includes("where") || q.includes("location") || q.includes("structure"))) {
    return "architecture";
  }
  return "convention";
}

function renderTemplate(s: QuerySuggestion): string {
  return [
    `# Auto-drafted from recurring searches`,
    ``,
    `> This memory was drafted by \`haive memory suggest --auto-save\` because`,
    `> agents searched for this **${s.count} times** in the recent window`,
    `> via ${s.tools.join(", ")}.`,
    ``,
    `## Query`,
    ``,
    `> ${s.query}`,
    ``,
    `## What to fill in`,
    ``,
    `Replace this section with the actual answer the team keeps re-discovering:`,
    ``,
    `- **What** — the convention / decision / gotcha (1-3 sentences)`,
    `- **Why** — the rationale or root cause`,
    `- **How to apply** — what an agent should do when this comes up again`,
    ``,
    `Then run \`haive memory promote ${truncate(s.query, 30)}\` to mark it validated.`,
  ].join("\n");
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}
