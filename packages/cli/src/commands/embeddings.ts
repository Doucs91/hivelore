import { existsSync } from "node:fs";
import path from "node:path";
import { Command } from "commander";
import { findProjectRoot, resolveHaivePaths } from "@hiveai/core";
import { ui } from "../utils/ui.js";

interface EmbeddingsOptions {
  dir?: string;
}

interface EmbeddingsQueryOptions extends EmbeddingsOptions {
  limit?: string;
  minScore?: string;
}

export function registerEmbeddings(program: Command): void {
  const embeddings = program
    .command("embeddings")
    .description("Manage local embeddings index for semantic search");

  embeddings
    .command("index")
    .description("Generate or refresh the embeddings index for all memories")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: EmbeddingsOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      if (!existsSync(paths.memoriesDir)) {
        ui.error(`No .ai/memories at ${root}. Run \`haive init\` first.`);
        process.exitCode = 1;
        return;
      }
      const { Embedder, rebuildIndex } = await loadEmbeddings();
      ui.info("Loading embedding model (first run downloads ~110MB)…");
      const embedder = await Embedder.create();
      ui.info(`Model ready: ${embedder.model} (dim=${embedder.dimension}). Indexing memories…`);
      const { report } = await rebuildIndex(paths, embedder);
      ui.success(
        `Indexed ${report.total} memories — added=${report.added} updated=${report.updated} unchanged=${report.unchanged} removed=${report.removed}`,
      );
    });

  embeddings
    .command("query <text>")
    .description("Run a semantic search against the local embeddings index")
    .option("-d, --dir <dir>", "project root")
    .option("--limit <n>", "max results", "10")
    .option("--min-score <n>", "minimum cosine similarity (0-1)", "0")
    .action(async (text: string, opts: EmbeddingsQueryOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const { semanticSearch } = await loadEmbeddings();
      const result = await semanticSearch(paths, text, {
        limit: Number(opts.limit ?? 10),
        minScore: Number(opts.minScore ?? 0),
      });
      if (!result) {
        ui.error("No embeddings index found. Run `haive embeddings index` first.");
        process.exitCode = 1;
        return;
      }
      if (result.hits.length === 0) {
        ui.info("No semantic matches above the threshold.");
        return;
      }
      for (const hit of result.hits) {
        const score = hit.score.toFixed(3);
        console.log(`${ui.bold(score)}  ${hit.id}`);
        console.log(`       ${ui.dim(path.relative(root, hit.file_path))}`);
      }
    });

  embeddings
    .command("status")
    .description("Show the embeddings index status")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: EmbeddingsOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);
      const { indexStat } = await loadEmbeddings();
      const stat = await indexStat(paths);
      if (!stat.exists) {
        ui.warn("No embeddings index. Run `haive embeddings index` to create one.");
        return;
      }
      console.log(`${ui.bold("entries:")}    ${stat.count}`);
      console.log(`${ui.bold("model:")}      ${stat.model}`);
      console.log(`${ui.bold("updated_at:")} ${stat.updatedAt}`);
      console.log(`${ui.bold("size:")}       ${(stat.sizeBytes / 1024).toFixed(1)} KB`);
    });
}

async function loadEmbeddings() {
  try {
    return await import("@hiveai/embeddings");
  } catch (err) {
    ui.error(
      "Could not load @hiveai/embeddings. Run: npm install -g @hiveai/embeddings  (or `pnpm build` in the monorepo)",
    );
    throw err;
  }
}
