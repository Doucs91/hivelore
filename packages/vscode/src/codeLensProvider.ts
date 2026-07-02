import * as vscode from "vscode";
import * as path from "path";
import type { MemoryStore } from "./memoryReader.js";

const TYPE_ICON: Record<string, string> = {
  skill: "⚡",
  gotcha: "⚠️",
  architecture: "🏗",
  convention: "📐",
  decision: "🎯",
  glossary: "📖",
  attempt: "🔁",
};

// Skills and gotchas shown before other types in the summary
const TYPE_ORDER = ["skill", "gotcha", "decision", "architecture", "convention", "glossary", "attempt"];

export class HaiveCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

  constructor(private readonly store: MemoryStore) {}

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration("hivelore");
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

    // Sort by TYPE_ORDER priority
    const typeSummary = [
      ...TYPE_ORDER.filter((t) => byType[t]),
      ...Object.keys(byType).filter((t) => !TYPE_ORDER.includes(t)),
    ]
      .map((t) => `${TYPE_ICON[t] ?? "📝"} ${byType[t]} ${t}`)
      .join(" · ");

    const label = actionRequired.length > 0
      ? `⚠️ Hivelore: ${memories.length} ${memories.length === 1 ? "memory" : "memories"} (${actionRequired.length} action required) — ${typeSummary}`
      : `🧠 Hivelore: ${memories.length} ${memories.length === 1 ? "memory" : "memories"} — ${typeSummary}`;

    lenses.push(
      new vscode.CodeLens(range, {
        title: label,
        command: "hivelore.showMemoriesForFile",
        arguments: [document.uri],
        tooltip: "Click to see all memories for this file in the Hivelore sidebar",
      }),
    );

    // ── Per-memory lenses — skills first, then by type order ──────────────
    const sorted = [...memories].sort((a, b) => {
      const ai = TYPE_ORDER.indexOf(a.type);
      const bi = TYPE_ORDER.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    for (const m of sorted) {
      const icon = m.requiresHumanApproval ? "⚠️" : (TYPE_ICON[m.type] ?? "📝");
      const shortTitle = m.title.length > 60 ? m.title.slice(0, 57) + "…" : m.title;
      const staleTag = m.status === "stale" ? " [stale]" : "";

      lenses.push(
        new vscode.CodeLens(range, {
          title: `  ${icon} ${shortTitle}${staleTag}`,
          command: "hivelore.openMemory",
          arguments: [m.filePath],
          tooltip: m.body.slice(0, 300).replace(/^#+\s*/gm, "").trim(),
        }),
      );
    }

    return lenses;
  }
}
