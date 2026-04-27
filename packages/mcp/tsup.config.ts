import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

const sharedExternal = [
  "@hiveai/core",
  "@hiveai/embeddings",
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
    define: { __HAIVE_VERSION__: JSON.stringify(version) },
    external: sharedExternal,
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    clean: false,
    sourcemap: true,
    target: "node20",
    define: { __HAIVE_VERSION__: JSON.stringify(version) },
    banner: { js: "#!/usr/bin/env node" },
    external: sharedExternal,
  },
]);
