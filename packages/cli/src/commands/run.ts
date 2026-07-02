import { Command } from "commander";
import { runWithEnforcement } from "./enforce.js";
import { ui } from "../utils/ui.js";

interface RunOptions {
  dir?: string;
  task?: string;
}

export function registerRun(program: Command): void {
  program
    .command("run")
    .description("Run any AI agent command inside a Hivelore-enforced session.")
    .option("-d, --dir <dir>", "project root")
    .option("--task <text>", "task text used for the Hivelore briefing marker")
    .allowUnknownOption(true)
    .argument("[cmd]", "agent command to run")
    .argument("[args...]", "agent command arguments")
    .action(async (cmd: string | undefined, args: string[], opts: RunOptions) => {
      if (!cmd) {
        ui.error("Usage: hivelore run -- <agent command> [args...]");
        process.exit(1);
      }
      await runWithEnforcement(cmd, args, opts);
    });
}
