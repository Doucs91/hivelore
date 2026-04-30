/**
 * Tree view provider for the "hAIve Memories" sidebar panel.
 *
 * Tree structure:
 *   ⚠️ Action Required (N)          ← if any requires_human_approval
 *     └─ [memory item]
 *   📁 This File (N)                 ← memories anchored to the active file
 *     └─ [memory item]
 *   🏗 Architecture (N)
 *   📐 Convention (N)
 *   🎯 Decision (N)
 *   ⚠️ Gotcha (N)
 *   📖 Glossary (N)
 *   📝 Other (N)
 */
import * as vscode from "vscode";
import * as path from "path";
import type { Memory, MemoryStore } from "./memoryReader.js";

// ── Icons ────────────────────────────────────────────────────────────────────

const TYPE_CODICON: Record<string, string> = {
  architecture: "symbol-class",
  convention: "symbol-ruler",
  decision: "symbol-boolean",
  gotcha: "warning",
  glossary: "book",
  attempt: "debug-restart",
};

const SCOPE_CODICON: Record<string, string> = {
  team: "organization",
  personal: "person",
  shared: "globe",
  module: "package",
};

const STATUS_BADGE: Record<string, string> = {
  validated: "",
  draft: " [draft]",
  stale: " [stale]",
  proposed: " [proposed]",
};

// ── Tree items ────────────────────────────────────────────────────────────────

export class GroupItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly memories: Memory[],
    public readonly groupKey: string,
    icon?: string,
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = "group";
    if (icon) this.iconPath = new vscode.ThemeIcon(icon);
    this.description = `${memories.length}`;
    this.tooltip = `${memories.length} ${memories.length === 1 ? "memory" : "memories"}`;
  }
}

export class MemoryItem extends vscode.TreeItem {
  constructor(public readonly memory: Memory) {
    super(memory.title, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "memory";
    this.tooltip = new vscode.MarkdownString(
      `**${memory.type}** · ${memory.scope} · ${memory.status}\n\n` +
      (memory.tags.length ? `Tags: \`${memory.tags.join("`, `")}\`\n\n` : "") +
      memory.body.slice(0, 500).trim() +
      (memory.body.length > 500 ? "\n\n…" : ""),
    );
    this.description = `${memory.scope}/${memory.type}${STATUS_BADGE[memory.status] ?? ""}`;

    // Open the memory file on click
    this.command = {
      command: "haive.openMemory",
      title: "Open Memory",
      arguments: [memory.filePath],
    };

    const iconId = memory.requiresHumanApproval
      ? "warning"
      : (TYPE_CODICON[memory.type] ?? "note");
    this.iconPath = new vscode.ThemeIcon(
      iconId,
      memory.requiresHumanApproval
        ? new vscode.ThemeColor("list.warningForeground")
        : memory.status === "stale"
        ? new vscode.ThemeColor("list.deemphasizedForeground")
        : undefined,
    );
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

export class HaiveTreeProvider
  implements vscode.TreeDataProvider<GroupItem | MemoryItem>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    GroupItem | MemoryItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private activeFileFilter: string | undefined;

  constructor(private readonly store: MemoryStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  /** Filter tree to memories anchored to a specific file (relative path). */
  filterToFile(relPath: string | undefined): void {
    this.activeFileFilter = relPath;
    this.refresh();
  }

  clearFilter(): void {
    this.activeFileFilter = undefined;
    this.refresh();
  }

  getTreeItem(element: GroupItem | MemoryItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: GroupItem | MemoryItem): (GroupItem | MemoryItem)[] {
    if (element instanceof MemoryItem) return [];

    if (element instanceof GroupItem) {
      return element.memories.map((m) => new MemoryItem(m));
    }

    // Root level — build groups
    const all = this.store.getAll();
    if (all.length === 0) return [];

    const groups: GroupItem[] = [];

    // ── Action Required (cross-cutting, shown first) ──────────────────────
    const actionRequired = all.filter(
      (m) => m.requiresHumanApproval && m.status !== "rejected",
    );
    if (actionRequired.length > 0) {
      const g = new GroupItem(
        "⚠️  Action Required",
        actionRequired,
        "action_required",
        "warning",
      );
      g.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
      groups.push(g);
    }

    // ── This File ──────────────────────────────────────────────────────────
    const fileFilter = this.activeFileFilter;
    if (fileFilter) {
      const fileMemories = this.store.forFile(fileFilter);
      if (fileMemories.length > 0) {
        const g = new GroupItem(
          `📄 This File (${path.basename(fileFilter)})`,
          fileMemories,
          "file",
          "file-code",
        );
        g.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        groups.push(g);
      }
    }

    // ── By type ────────────────────────────────────────────────────────────
    const typeOrder = ["architecture", "convention", "decision", "gotcha", "glossary", "attempt"];
    const typeLabels: Record<string, string> = {
      architecture: "🏗  Architecture",
      convention: "📐  Conventions",
      decision: "🎯  Decisions",
      gotcha: "⚠️  Gotchas",
      glossary: "📖  Glossary",
      attempt: "🔁  Attempts",
    };

    const byType = new Map<string, Memory[]>();
    for (const m of all) {
      if (!byType.has(m.type)) byType.set(m.type, []);
      byType.get(m.type)!.push(m);
    }

    for (const type of typeOrder) {
      const mems = byType.get(type);
      if (!mems || mems.length === 0) continue;
      const label = typeLabels[type] ?? type;
      const icon = TYPE_CODICON[type] ?? "note";
      const g = new GroupItem(label, mems, type, icon);
      // Collapse by default unless it's a small group
      g.collapsibleState =
        mems.length <= 3
          ? vscode.TreeItemCollapsibleState.Expanded
          : vscode.TreeItemCollapsibleState.Collapsed;
      groups.push(g);
    }

    // Unknown types
    const otherTypes = [...byType.keys()].filter((t) => !typeOrder.includes(t));
    for (const type of otherTypes) {
      const mems = byType.get(type)!;
      groups.push(new GroupItem(`📝  ${type}`, mems, type, "note"));
    }

    return groups;
  }
}
