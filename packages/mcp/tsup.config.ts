import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: ["src/server.ts"],
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "node20",
  },
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    clean: false,
    sourcemap: true,
    target: "node20",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
