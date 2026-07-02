import { existsSync } from "node:fs";
import {
  loadMemoriesFromDir,
  tokenizeQuery,
  type LoadedMemory,
} from "@hivelore/core";
import { z } from "zod";
import type { HaiveContext } from "../context.js";

export const MemDistillInputSchema = {
  since_days: z
    .number()
    .int()
    .positive()
    .default(30)
    .describe("Only consider memories created in the last N days."),
  min_cluster: z
    .number()
    .int()
    .min(2)
    .default(3)
    .describe("Minimum cluster size to surface."),
  type_filter: z
    .enum(["gotcha", "attempt", "all"])
    .default("gotcha")
    .describe(
      "Memory type to scan. 'gotcha' targets observe-style discoveries that recur, " +
      "'attempt' surfaces failed approaches that repeat, 'all' considers both.",
    ),
  scope: z
    .enum(["personal", "team", "module", "any"])
    .default("any")
    .describe("Restrict to a specific scope."),
};

export type MemDistillInput = {
  [K in keyof typeof MemDistillInputSchema]: z.infer<(typeof MemDistillInputSchema)[K]>;
};

export interface DistillCluster {
  suggested_topic: string;
  suggested_type: "convention" | "gotcha";
  member_ids: string[];
  overlapping_paths: string[];
  common_keywords: string[];
  sample_titles: string[];
  /** ISO date of the latest member */
  latest_at: string;
}

export interface MemDistillOutput {
  scanned: number;
  /** Memories that didn't fit any cluster (kept here so callers can inspect singletons). */
  singletons: number;
  clusters: DistillCluster[];
  notice?: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const STOP_WORDS = new Set([
  "the","and","for","with","that","this","from","into","when","then","also","must",
  "have","does","not","but","you","your","its","because","why","how","what",
  "use","using","used","add","added","make","made","fix","fixed","bug","error",
]);

/**
 * Cluster recurring observations / attempts so a human can collapse N similar
 * memories into one richer convention/gotcha. Uses cheap heuristics (anchor
 * path overlap + body keyword overlap) — no embeddings needed.
 *
 * Output is *advisory*: nothing is written to disk. The caller (CLI / human)
 * decides whether to mem_save the consolidated form.
 */
export async function memDistill(
  input: MemDistillInput,
  ctx: HaiveContext,
): Promise<MemDistillOutput> {
  if (!existsSync(ctx.paths.memoriesDir)) {
    return { scanned: 0, singletons: 0, clusters: [], notice: "No .ai/memories directory." };
  }

  const cutoff = Date.now() - input.since_days * MS_PER_DAY;
  const all = await loadMemoriesFromDir(ctx.paths.memoriesDir);
  const candidates = all.filter(({ memory }) => {
    const fm = memory.frontmatter;
    if (fm.status === "rejected" || fm.status === "deprecated" || fm.status === "stale") return false;
    if (input.scope !== "any" && fm.scope !== input.scope) return false;
    if (input.type_filter === "gotcha" && fm.type !== "gotcha") return false;
    if (input.type_filter === "attempt" && fm.type !== "attempt") return false;
    if (input.type_filter === "all" && fm.type !== "gotcha" && fm.type !== "attempt") return false;
    if (Date.parse(fm.created_at) < cutoff) return false;
    return true;
  });

  if (candidates.length < input.min_cluster) {
    return {
      scanned: candidates.length,
      singletons: candidates.length,
      clusters: [],
      notice: candidates.length === 0
        ? `No matching memories in the last ${input.since_days} days.`
        : `Only ${candidates.length} candidate${candidates.length === 1 ? "" : "s"} — below min_cluster=${input.min_cluster}.`,
    };
  }

  // Pre-compute features per memory: keyword set + path set
  const features = candidates.map((loaded) => ({
    loaded,
    keywords: keywordSet(loaded),
    paths: new Set<string>(loaded.memory.frontmatter.anchor.paths),
  }));

  // Single-linkage clustering: union-find by similarity threshold.
  const parent: number[] = features.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i] ?? 0)));
  const union = (a: number, b: number): void => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const fi = features[i]!, fj = features[j]!;
      const pathSim = jaccard(fi.paths, fj.paths);
      const kwSim = jaccard(fi.keywords, fj.keywords);
      // Either strong path overlap OR strong keyword overlap qualifies.
      if (pathSim >= 0.5 || kwSim >= 0.4) union(i, j);
    }
  }

  // Group by root parent
  const groups = new Map<number, number[]>();
  for (let i = 0; i < features.length; i++) {
    const root = find(i);
    const arr = groups.get(root) ?? [];
    arr.push(i);
    groups.set(root, arr);
  }

  const clusters: DistillCluster[] = [];
  let singletons = 0;
  for (const indices of groups.values()) {
    if (indices.length < input.min_cluster) {
      singletons += indices.length;
      continue;
    }
    const members = indices.map((i) => features[i]!);
    const allPaths = new Set<string>();
    const allKeywords = new Map<string, number>();
    let latest = 0;
    for (const m of members) {
      for (const p of m.paths) allPaths.add(p);
      for (const k of m.keywords) allKeywords.set(k, (allKeywords.get(k) ?? 0) + 1);
      const t = Date.parse(m.loaded.memory.frontmatter.created_at);
      if (t > latest) latest = t;
    }
    const commonKeywords = [...allKeywords.entries()]
      .filter(([, n]) => n >= Math.max(2, Math.floor(members.length / 2)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k]) => k);

    const titles = members
      .map((m) => firstHeading(m.loaded.memory.body) ?? m.loaded.memory.frontmatter.id)
      .slice(0, 5);

    const suggestedType: DistillCluster["suggested_type"] =
      members.every((m) => m.loaded.memory.frontmatter.type === "attempt") ? "gotcha" : "convention";

    clusters.push({
      suggested_topic: commonKeywords.slice(0, 3).join("-") || "merged-observations",
      suggested_type: suggestedType,
      member_ids: members.map((m) => m.loaded.memory.frontmatter.id),
      overlapping_paths: [...allPaths].slice(0, 10),
      common_keywords: commonKeywords,
      sample_titles: titles,
      latest_at: new Date(latest).toISOString(),
    });
  }

  // Sort clusters by size desc
  clusters.sort((a, b) => b.member_ids.length - a.member_ids.length);

  return {
    scanned: candidates.length,
    singletons,
    clusters,
  };
}

function keywordSet(loaded: LoadedMemory): Set<string> {
  const text = (loaded.memory.body + " " + loaded.memory.frontmatter.tags.join(" ")).slice(0, 800);
  const tokens = tokenizeQuery(text)
    .filter((t) => t.length >= 4 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersect = 0;
  for (const x of a) if (b.has(x)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

function firstHeading(body: string): string | undefined {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.startsWith("#")) return t.replace(/^#+\s*/, "").slice(0, 80);
    if (t.length > 0) return t.slice(0, 80);
  }
  return undefined;
}
