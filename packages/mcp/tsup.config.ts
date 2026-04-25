import { defineConfig } from "tsup";

const sharedExternal = [
  "@haive/core",
  "@haive/embeddings",
  "@xenova/transformers",
  "@modelcontextprotocol/sdk",
  "zod",
  "gray-matter",
];

export default defineConfig([
  {
    entry: ["src/server.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node20",
    external: sharedExternal,
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    clean: false,
    sourcemap: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
    external: sharedExternal,
  },
]);
