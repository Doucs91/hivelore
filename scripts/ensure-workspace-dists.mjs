#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const packages = new Map([
  ["@hiveai/core", "packages/core/dist/index.d.ts"],
  ["@hiveai/embeddings", "packages/embeddings/dist/index.d.ts"],
  ["@hiveai/mcp", "packages/mcp/dist/server.d.ts"],
]);

const requested = process.argv.slice(2);
if (requested.length === 0) process.exit(0);

for (const name of requested) {
  const dts = packages.get(name);
  if (!dts) {
    console.error(`[haive] unknown workspace package: ${name}`);
    process.exit(1);
  }
  if (existsSync(path.join(root, dts))) continue;
  runPnpm(["--filter", name, "build"]);
}

function runPnpm(args) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath && npmExecPath.includes("pnpm")
    ? process.execPath
    : "pnpm";
  const finalArgs = npmExecPath && npmExecPath.includes("pnpm")
    ? [npmExecPath, ...args]
    : args;
  const result = spawnSync(command, finalArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
