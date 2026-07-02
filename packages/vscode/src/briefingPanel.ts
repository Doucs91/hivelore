import * as vscode from "vscode";
import { runHaive } from "./harnessHealth.js";

export class BriefingPanel {
  private readonly channel: vscode.OutputChannel;

  constructor() {
    this.channel = vscode.window.createOutputChannel("Hivelore Briefing", "markdown");
  }

  async runForFile(workspaceRoot: string, relFile?: string): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("hivelore");
    const budget = cfg.get<string>("briefingBudget") ?? "default";

    const args = ["briefing", "--budget", budget];
    if (relFile) args.push("--files", relFile);

    this.channel.clear();
    this.channel.appendLine(`# Hivelore Briefing — ${new Date().toLocaleTimeString()}`);
    if (relFile) this.channel.appendLine(`> File: ${relFile}`);
    this.channel.appendLine("");
    this.channel.show(true);

    try {
      const result = await runHaive(workspaceRoot, args);
      this.channel.append(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.channel.appendLine(`Error running hivelore briefing: ${msg}`);
      this.channel.appendLine(
        "\nMake sure `hivelore` is installed globally: npm install -g @hivelore/cli",
      );
    }
  }

  dispose(): void {
    this.channel.dispose();
  }
}
