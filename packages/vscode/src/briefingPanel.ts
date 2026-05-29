import * as vscode from "vscode";
import { runHaive } from "./harnessHealth.js";

export class BriefingPanel {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("hAIve Briefing", "markdown");
  }

  async runForFile(workspaceRoot: string, relFile?: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("haive");
    const budget = cfg.get<string>("briefingBudget") ?? "default";

    const args = ["briefing", "--budget", budget];
    if (relFile) args.push("--files", relFile);

    this.channel.clear();
    this.channel.appendLine(`# hAIve Briefing — ${new Date().toLocaleTimeString()}`);
    if (relFile) this.channel.appendLine(`> File: ${relFile}`);
    this.channel.appendLine("");
    this.channel.show(true);

    try {
      const result = await runHaive(workspaceRoot, args);
      this.channel.append(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.channel.appendLine(`Error running haive briefing: ${msg}`);
      this.channel.appendLine(
        "\nMake sure `haive` is installed globally: npm install -g @hiveai/cli",
      );
    }
  }

  dispose(): void {
    this.channel.dispose();
  }
}
