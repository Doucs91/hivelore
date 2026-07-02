import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  clean: true,
  sourcemap: true,
  target: "node20",
  define: { __HAIVE_VERSION__: JSON.stringify(version) },
  /** Ship MCP inside the haive binary — only one global install needed. */
  noExternal: ["@hivelore/mcp"],
  banner: { js: "#!/usr/bin/env node" },
  esbuildOptions(options) {
    options.jsx = "automatic";
    options.jsxImportSource = "react";
  },
  external: [
    "@hivelore/core",
    "@hivelore/embeddings",
    "@xenova/transformers",
    "@modelcontextprotocol/sdk",
    "commander",
    "picocolors",
    "gray-matter",
    "zod",
  ],
});
