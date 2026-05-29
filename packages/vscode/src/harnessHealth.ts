import * as vscode from "vscode";
import * as cp from "child_process";

export interface DoctorScores {
  protection: number;
  context_quality: number;
  corpus_quality: number;
  harness_coverage_score: number;
}

export interface DoctorFinding {
  section: string;
  level: "error" | "warn" | "info" | "ok";
  code: string;
  message: string;
}

export interface DoctorResult {
  scores: DoctorScores;
  findings: DoctorFinding[];
  error?: string;
}

// ── Tree items ────────────────────────────────────────────────────────────────

class ScoreItem extends vscode.TreeItem {
  constructor(label: string, score: number, detail?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = detail ?? `${score}%`;
    const icon =
      score >= 90 ? "pass" :
      score >= 70 ? "pass-filled" :
      score >= 50 ? "warning" : "error";
    this.iconPath = new vscode.ThemeIcon(
      icon,
      score >= 90
        ? new vscode.ThemeColor("testing.iconPassed")
        : score >= 70
        ? new vscode.ThemeColor("charts.yellow")
        : new vscode.ThemeColor("list.warningForeground"),
    );
    this.tooltip = `${label}: ${score}%${detail ? ` — ${detail}` : ""}`;
  }
}

class FindingItem extends vscode.TreeItem {
  constructor(finding: DoctorFinding) {
    super(finding.message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "finding";
    this.description = finding.code;
    const icon =
      finding.level === "error" ? "error" :
      finding.level === "warn" ? "warning" :
      finding.level === "ok" ? "pass" : "info";
    this.iconPath = new vscode.ThemeIcon(icon);
    this.tooltip = `[${finding.section}] ${finding.code}: ${finding.message}`;
  }
}

class SectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly children: vscode.TreeItem[],
    icon: string,
  ) {
    super(
      label,
      children.length === 0
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed,
    );
    this.iconPath = new vscode.ThemeIcon(icon);
    this.description = children.length === 0 ? "clean" : `${children.length} finding${children.length > 1 ? "s" : ""}`;
    this.contextValue = "section";
  }
}

type HealthItem = ScoreItem | FindingItem | SectionItem;

// ── Provider ─────────────────────────────────────────────────────────────────

export class HarnessHealthProvider implements vscode.TreeDataProvider<HealthItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<HealthItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private result: DoctorResult | null = null;
  private loading = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly outputChannel: vscode.OutputChannel,
  ) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  async runDoctor(): Promise<void> {
    if (this.loading) return;
    this.loading = true;
    this.result = null;
    this.refresh();

    try {
      const raw = await runHaive(this.workspaceRoot, ["doctor", "--json"]);
      this.outputChannel.appendLine(`\n[haive doctor] ${new Date().toLocaleTimeString()}`);
      this.outputChannel.appendLine(raw);

      const json = JSON.parse(raw) as {
        scores?: DoctorScores;
        findings?: DoctorFinding[];
      };
      this.result = {
        scores: json.scores ?? { protection: 0, context_quality: 0, corpus_quality: 0, harness_coverage_score: 0 },
        findings: json.findings ?? [],
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.result = {
        scores: { protection: 0, context_quality: 0, corpus_quality: 0, harness_coverage_score: 0 },
        findings: [],
        error: msg,
      };
      this.outputChannel.appendLine(`[haive doctor error] ${msg}`);
    } finally {
      this.loading = false;
      this.refresh();
    }
  }

  getTreeItem(element: HealthItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: HealthItem): HealthItem[] {
    if (element instanceof SectionItem) {
      return element.children as HealthItem[];
    }
    if (element) return [];

    if (this.loading) {
      const item = new vscode.TreeItem("Running haive doctor…");
      item.iconPath = new vscode.ThemeIcon("loading~spin");
      return [item as HealthItem];
    }

    if (!this.result) {
      const item = new vscode.TreeItem("Click ▶ to run health check");
      item.iconPath = new vscode.ThemeIcon("play");
      item.command = { command: "haive.runDoctor", title: "Run Doctor" };
      return [item as HealthItem];
    }

    if (this.result.error) {
      const item = new vscode.TreeItem(`Error: ${this.result.error}`);
      item.iconPath = new vscode.ThemeIcon("error");
      return [item as HealthItem];
    }

    const { scores, findings } = this.result;
    const items: HealthItem[] = [
      new ScoreItem("Protection", scores.protection),
      new ScoreItem("Context Quality", scores.context_quality),
      new ScoreItem("Corpus Quality", scores.corpus_quality),
      new ScoreItem("Harness Coverage", scores.harness_coverage_score),
    ];

    // Group findings by section
    const sections = new Map<string, DoctorFinding[]>();
    for (const f of findings) {
      if (!sections.has(f.section)) sections.set(f.section, []);
      sections.get(f.section)!.push(f);
    }

    if (sections.size > 0) {
      for (const [section, sectionFindings] of sections) {
        const hasErrors = sectionFindings.some((f) => f.level === "error");
        const hasWarns = sectionFindings.some((f) => f.level === "warn");
        const icon = hasErrors ? "error" : hasWarns ? "warning" : "info";
        items.push(
          new SectionItem(
            section,
            sectionFindings.map((f) => new FindingItem(f)),
            icon,
          ),
        );
      }
    } else {
      const ok = new vscode.TreeItem("All checks passed");
      ok.iconPath = new vscode.ThemeIcon("pass", new vscode.ThemeColor("testing.iconPassed"));
      items.push(ok as HealthItem);
    }

    return items;
  }
}

// ── CLI runner ────────────────────────────────────────────────────────────────

export function runHaive(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const cfg = vscode.workspace.getConfiguration("haive");
    const binary = cfg.get<string>("cliPath") || "haive";

    cp.execFile(binary, args, { cwd, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
      if (err && !stdout) {
        reject(new Error(stderr || err.message));
        return;
      }
      resolve(stdout);
    });
  });
}
