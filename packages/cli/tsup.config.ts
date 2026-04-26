import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  external: [
    "@hiveai/core",
    "@hiveai/mcp",
    "@hiveai/embeddings",
    "@xenova/transformers",
    "@modelcontextprotocol/sdk",
    "commander",
    "picocolors",
    "gray-matter",
    "zod",
  ],
});
