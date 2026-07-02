/**
 * hivelore snapshot — take or compare an API contract snapshot.
 *
 *   hivelore snapshot --contract openapi.yaml --name payment-api
 *   hivelore snapshot --contract schema.graphql --format graphql
 *   hivelore snapshot --diff --name payment-api
 *   hivelore snapshot --list
 */
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import {
  diffContract,
  findProjectRoot,
  loadConfig,
  resolveHaivePaths,
  snapshotContract,
} from "@hivelore/core";
import type { ContractFile } from "@hivelore/core";
import { ui } from "../utils/ui.js";

interface SnapshotOptions {
  contract?: string;
  name?: string;
  format?: string;
  diff?: boolean;
  list?: boolean;
  dir?: string;
}

export function registerSnapshot(program: Command): void {
  program
    .command("snapshot")
    .description(
      "Take or compare an API contract snapshot to detect breaking changes.\n\n" +
      "  A snapshot captures the structure of a contract file (endpoints, types, fields).\n" +
      "  Running 'hivelore sync' automatically checks all configured contracts.\n" +
      "  This command lets you snapshot or diff a single contract on demand.\n\n" +
      "  Supported formats: openapi, graphql, proto, typescript, json-schema\n\n" +
      "  Examples:\n" +
      "    hivelore snapshot --contract docs/openapi.yaml --name payment-api\n" +
      "    hivelore snapshot --diff --name payment-api\n" +
      "    hivelore snapshot --list\n\n" +
      "  To monitor contracts automatically on hivelore sync, add them to haive.config.json:\n" +
      "    { \"contractFiles\": [{ \"name\": \"payment-api\", \"path\": \"docs/openapi.yaml\", \"format\": \"openapi\" }] }\n",
    )
    .option("--contract <file>", "path to the contract file to snapshot (relative to project root)")
    .option("--name <name>", "name for this contract (used in the lock file and memories)")
    .option(
      "--format <format>",
      "contract format: openapi | graphql | proto | typescript | json-schema (auto-detected if omitted)",
    )
    .option("--diff", "compare the contract against its stored snapshot")
    .option("--list", "list all stored contract snapshots")
    .option("-d, --dir <dir>", "project root")
    .action(async (opts: SnapshotOptions) => {
      const root = findProjectRoot(opts.dir);
      const paths = resolveHaivePaths(root);

      if (!existsSync(paths.haiveDir)) {
        ui.error("No .ai/ found. Run `hivelore init` first.");
        process.exitCode = 1;
        return;
      }

      // hivelore snapshot --list
      if (opts.list) {
        const contractsDir = path.join(paths.haiveDir, "contracts");
        if (!existsSync(contractsDir)) {
          console.log(ui.dim("No contract snapshots found."));
          return;
        }
        const files = (await readdir(contractsDir)).filter(
          (f) => f.endsWith(".lock") && !f.startsWith("deps-"),
        );
        if (files.length === 0) {
          console.log(ui.dim("No contract snapshots found."));
          return;
        }
        console.log(ui.bold(`Contract snapshots (${files.length}):`));
        for (const f of files) {
          const name = f.replace(".lock", "");
          console.log(`  ${name}`);
        }
        return;
      }

      // hivelore snapshot --diff --name <name>
      if (opts.diff) {
        if (!opts.name) {
          // Try all configured contracts
          const config = await loadConfig(paths);
          const contracts = config.contractFiles ?? [];
          if (contracts.length === 0) {
            ui.error("--diff requires --name, or configure contractFiles in haive.config.json");
            process.exitCode = 1;
            return;
          }
          for (const contract of contracts) {
            await runDiff(root, paths.haiveDir, contract);
          }
          return;
        }

        // Diff a named contract (need to know path — check config)
        const config = await loadConfig(paths);
        const configured = (config.contractFiles ?? []).find((c) => c.name === opts.name);
        if (!configured && !opts.contract) {
          ui.error(
            `Contract "${opts.name}" not found in haive.config.json and --contract not provided.`,
          );
          process.exitCode = 1;
          return;
        }
        const contract: ContractFile = configured ?? {
          name: opts.name!,
          path: opts.contract!,
          format: detectFormat(opts.contract ?? "") ?? "openapi",
        };
        await runDiff(root, paths.haiveDir, contract);
        return;
      }

      // hivelore snapshot --contract <file> [--name <name>] [--format <format>]
      if (!opts.contract) {
        ui.error("Provide --contract <file> or use --diff / --list.");
        process.exitCode = 1;
        return;
      }

      const contractPath = opts.contract;
      const name = opts.name ?? path.basename(contractPath, path.extname(contractPath));
      const format =
        (opts.format as ContractFile["format"]) ?? detectFormat(contractPath) ?? "openapi";

      const contract: ContractFile = { name, path: contractPath, format };
      try {
        const snapshot = await snapshotContract(root, paths.haiveDir, contract);
        console.log(ui.green(`✓ snapshot saved: ${name}`));
        if (snapshot.endpoints) {
          console.log(ui.dim(`  ${snapshot.endpoints.length} endpoint(s) captured`));
        }
        if (snapshot.types) {
          console.log(ui.dim(`  ${snapshot.types.length} type(s) captured`));
        }
        console.log(ui.dim(`  lock: .ai/contracts/${name}.lock`));
        console.log(ui.dim("  Next hivelore sync will detect changes automatically."));
        console.log(
          ui.dim(
            `  Tip: add to haive.config.json → contractFiles to monitor automatically:\n` +
            `  { "name": "${name}", "path": "${contractPath}", "format": "${format}" }`,
          ),
        );
      } catch (err) {
        ui.error(String(err));
        process.exitCode = 1;
      }
    });
}

async function runDiff(
  root: string,
  haiveDir: string,
  contract: ContractFile,
): Promise<void> {
  try {
    const result = await diffContract(root, haiveDir, contract);
    if (result.unchanged) {
      console.log(ui.green(`✓ ${contract.name}: no changes detected`));
      return;
    }
    const breaking = result.changes.filter((c) => c.severity === "breaking");
    const additive = result.changes.filter((c) => c.severity === "additive");
    const unknown = result.changes.filter((c) => c.severity === "unknown");

    console.log(
      ui.bold(`Contract diff: ${contract.name}`) +
      ` — ${breaking.length} breaking · ${additive.length} additive · ${unknown.length} unknown`,
    );
    for (const c of result.changes) {
      const icon = c.severity === "breaking" ? "🔴" : c.severity === "additive" ? "🟢" : "🟡";
      console.log(`  ${icon} ${c.description}`);
    }
    if (breaking.length > 0) {
      console.log(
        ui.yellow(
          "\n  ⚠ Breaking changes detected — run `hivelore sync` to create a gotcha memory for your team.",
        ),
      );
    }
  } catch (err) {
    ui.error(`diff failed for ${contract.name}: ${String(err)}`);
  }
}

function detectFormat(filePath: string): ContractFile["format"] | null {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  if (ext === ".yaml" || ext === ".yml" || ext === ".json") {
    if (base.includes("openapi") || base.includes("swagger")) return "openapi";
    if (base.includes("schema") || base.includes("graphql")) return "graphql";
    return "openapi"; // default for YAML/JSON
  }
  if (ext === ".graphql" || ext === ".gql") return "graphql";
  if (ext === ".proto") return "proto";
  if (ext === ".d.ts" || ext === ".ts") return "typescript";
  return null;
}
