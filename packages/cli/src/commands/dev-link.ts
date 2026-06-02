import { execFile } from "node:child_process";
import { cp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Command } from "commander";
import { findProjectRoot } from "@hiveai/core";
import { ui } from "../utils/ui.js";

const exec = promisify(execFile);

interface DevLinkOptions {
  dir?: string;
  json?: boolean;
}

/**
 * Copy the repo's freshly-built `dist/` into the globally-installed `@hiveai/*` so the `haive`
 * binary (and the MCP server / git hooks that shell out to it) run your LOCAL code — without an
 * npm publish cycle. Codifies the hot-swap recipe that was previously a copy-paste shell snippet,
 * including the nested `@hiveai/core` copies that pnpm workspaces require.
 */
export function registerDevLink(program: Command): void {
  const dev = program.commands.find((c) => c.name() === "dev") ?? program.command("dev").description("Developer utilities for working on hAIve itself.");
  dev
    .command("link")
    .description("Hot-swap this repo's built dist into the global @hiveai install so `haive` runs your local code.")
    .option("-d, --dir <dir>", "repo root (default: discovered from cwd)")
    .option("--json", "emit a machine-readable summary", false)
    .action(async (opts: DevLinkOptions) => {
      const root = findProjectRoot(opts.dir);
      if (!existsSync(path.join(root, "packages", "cli", "dist", "index.js"))) {
        ui.error(`Not the hAIve monorepo (no packages/cli/dist) at ${root}. Run \`pnpm -r build\` first, or pass --dir.`);
        process.exitCode = 1;
        return;
      }

      let globalModules: string;
      try {
        globalModules = (await exec("npm", ["root", "-g"])).stdout.trim();
      } catch {
        // Fallback: derive from the running node binary (…/bin/node → …/lib/node_modules).
        globalModules = path.join(path.dirname(path.dirname(process.execPath)), "lib", "node_modules");
      }
      const globalHive = path.join(globalModules, "@hiveai");
      if (!existsSync(globalHive)) {
        ui.error(`No global @hiveai install at ${globalHive}. Install once with \`npm i -g @hiveai/cli\`, then re-run.`);
        process.exitCode = 1;
        return;
      }

      const linked: string[] = [];
      const copyDist = async (fromPkg: string, toDistDir: string): Promise<void> => {
        const from = path.join(root, "packages", fromPkg, "dist");
        if (!existsSync(from) || !existsSync(path.dirname(toDistDir))) return;
        await cp(from, toDistDir, { recursive: true });
        linked.push(path.relative(globalModules, toDistDir));
      };

      // The globally-installed packages are cli and mcp; core/embeddings live nested inside them.
      for (const pkg of ["cli", "mcp"] as const) {
        await copyDist(pkg, path.join(globalHive, pkg, "dist"));
        // Nested workspace deps that pnpm placed under each package.
        for (const nested of ["core", "embeddings"] as const) {
          await copyDist(nested, path.join(globalHive, pkg, "node_modules", "@hiveai", nested, "dist"));
        }
      }
      // A top-level global @hiveai/core (npm-flat installs) if present.
      await copyDist("core", path.join(globalHive, "core", "dist"));

      let version = "unknown";
      try {
        version = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version ?? "unknown";
      } catch { /* ignore */ }

      if (opts.json) {
        console.log(JSON.stringify({ ok: linked.length > 0, version, global_root: globalHive, linked }, null, 2));
        return;
      }
      if (linked.length === 0) {
        ui.warn("Nothing linked — no matching dist targets were found in the global install.");
        return;
      }
      ui.success(`Linked local dist (v${version}) into the global @hiveai install:`);
      for (const t of linked) console.log(`  ${ui.dim("→")} ${t}`);
      console.log(ui.dim("The global `haive` now runs your local build (git hooks + MCP included)."));
    });
}
