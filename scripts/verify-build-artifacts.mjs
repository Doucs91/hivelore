#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repoRoot, relativePath), "utf8"));
}

const rootPkg = await readJson("package.json");
const lockstepPackages = [
  "packages/core/package.json",
  "packages/embeddings/package.json",
  "packages/mcp/package.json",
  "packages/cli/package.json",
];

const failures = [];

for (const pkgPath of lockstepPackages) {
  const pkg = await readJson(pkgPath);
  if (pkg.version !== rootPkg.version) {
    failures.push(`${pkgPath} version ${pkg.version} does not match root ${rootPkg.version}`);
  }
}

const cli = spawnSync(process.execPath, ["packages/cli/dist/index.js", "--version"], {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (cli.status !== 0) {
  failures.push(`built CLI failed to run: ${cli.stderr.trim() || `exit ${cli.status}`}`);
} else {
  const builtVersion = cli.stdout.trim();
  if (builtVersion !== rootPkg.version) {
    failures.push(`built CLI reports ${builtVersion}, expected ${rootPkg.version}`);
  }
}

const mcp = await import(path.join(repoRoot, "packages/mcp/dist/server.js"));
if (mcp.SERVER_VERSION !== rootPkg.version) {
  failures.push(`built MCP reports ${mcp.SERVER_VERSION}, expected ${rootPkg.version}`);
}

if (failures.length > 0) {
  console.error("Hivelore build artifact verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Hivelore build artifacts OK (${rootPkg.version})`);
