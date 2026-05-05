import path from "node:path";
import { Command } from "commander";
import { resolveProjectInfo } from "@hiveai/core";

export function registerResolveProject(program: Command): void {
  program
    .command("resolve-project")
    .description(
      "Print JSON for hAIve project root resolution (HAIVE_PROJECT_ROOT, markers, .ai layout).",
    )
    .option("-d, --dir <dir>", "working directory", process.cwd())
    .action((opts: { dir: string }) => {
      const info = resolveProjectInfo({ cwd: path.resolve(opts.dir) });
      console.log(JSON.stringify({ ok: true, info }, null, 2));
    });
}
