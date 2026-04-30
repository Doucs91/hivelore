/**
 * CodeLens provider — shows an inline "🧠 N memories" lens at the top of
 * files that have anchored hAIve memories.
 *
 * Clicking the lens opens the hAIve sidebar and filters to that file.
 */
import * as vscode from "vscode";
import * as path from "path";
import type { MemoryStore } from "./memoryReader.js";

const TYPE_ICON: Record<string, string> = {
  gotcha: "⚠️",
  architecture: "🏗",
  convention: "📐",
  decision: "🎯",
  glossary: "📖",
  attempt: "🔁",
};

export class HaiveCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly store: MemoryStore) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration("haive");
    if (!cfg.get<boolean>("showCodeLens", true)) return [];
    if (!this.store.isInitialized()) return [];

    const relPath = path.relative(this.store.workspaceRoot, document.fileName)
      .replace(/\\/g, "/");

    const memories = this.store.forFile(relPath);
    if (memories.length === 0) return [];

    const range = new vscode.Range(0, 0, 0, 0);
    const lenses: vscode.CodeLens[] = [];

    // ── Summary lens ──────────────────────────────────────────────────────
    const actionRequired = memories.filter((m) => m.requiresHumanApproval);
    const byType = memories.reduce<Record<string, number>>((acc, m) => {
      acc[m.type] = (acc[m.type] ?? 0) + 1;
      return acc;
    }, {});

    const typeSummary = Object.entries(byType)
      .map(([t, n]) => `${TYPE_ICON[t] ?? "📝"} ${n} ${t}`)
      .join(" · ");

    const label = actionRequired.length > 0
      ? `⚠️ hAIve: ${memories.length} ${memories.length === 1 ? "memory" : "memories"} (${actionRequired.length} action required) — ${typeSummary}`
      : `🧠 hAIve: ${memories.length} ${memories.length === 1 ? "memory" : "memories"} — ${typeSummary}`;

    lenses.push(
      new vscode.CodeLens(range, {
        title: label,
        command: "haive.showMemoriesForFile",
        arguments: [document.uri],
        tooltip: "Click to see all memories for this file in the hAIve sidebar",
      }),
    );

    // ── Per-memory lenses (shown as sub-items) ────────────────────────────
    for (const m of memories) {
      const icon = m.requiresHumanApproval
        ? "⚠️"
        : (TYPE_ICON[m.type] ?? "📝");
      const shortTitle = m.title.length > 60 ? m.title.slice(0, 57) + "…" : m.title;

      lenses.push(
        new vscode.CodeLens(range, {
          title: `  ${icon} ${shortTitle}`,
          command: "haive.openMemory",
          arguments: [m.filePath],
          tooltip: m.body.slice(0, 300).replace(/^#+\s*/gm, "").trim(),
        }),
      );
    }

    return lenses;
  }
}
