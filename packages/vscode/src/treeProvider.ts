import * as vscode from "vscode";
import * as path from "path";
import type { Memory, MemoryStore } from "./memoryReader.js";

// ── Icons ────────────────────────────────────────────────────────────────────

const TYPE_CODICON: Record<string, string> = {
  skill: "symbol-event",
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
  deprecated: " [deprecated]",
};

// ── Tree items ────────────────────────────────────────────────────────────────

export class GroupItem extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly memories: Memory[],
    public readonly groupKey: string,
    icon?: string,
    collapsed?: boolean,
  ) {
    super(
      label,
      collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded,
    );
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

    const statusBadge = STATUS_BADGE[memory.status] ?? ` [${memory.status}]`;
    this.description = `${memory.scope}${statusBadge}`;

    // Rich tooltip
    const lines: string[] = [
      `**${memory.type}** · ${memory.scope} · ${memory.status}`,
      "",
    ];
    if (memory.tags.length) lines.push(`Tags: \`${memory.tags.join("`, `")}\``);
    if (memory.module) lines.push(`Module: ${memory.module}`);
    if (memory.readCount > 0) lines.push(`Read ${memory.readCount}×`);
    lines.push("", memory.body.slice(0, 600).trim() + (memory.body.length > 600 ? "\n\n…" : ""));
    this.tooltip = new vscode.MarkdownString(lines.join("\n"));

    this.command = {
      command: "haive.openMemory",
      title: "Open Memory",
      arguments: [memory.filePath],
    };

    const iconId = memory.requiresHumanApproval
      ? "warning"
      : memory.status === "stale"
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

    const all = this.store.getAll();
    if (all.length === 0) return [];

    const groups: GroupItem[] = [];

    // ── Action Required ────────────────────────────────────────────────────
    const actionRequired = all.filter(
      (m) => m.requiresHumanApproval && m.status !== "rejected",
    );
    if (actionRequired.length > 0) {
      groups.push(new GroupItem("⚠️  Action Required", actionRequired, "action_required", "warning"));
    }

    // ── Skills (feedforward harness guides — always first after alerts) ────
    const skills = all.filter((m) => m.type === "skill");
    if (skills.length > 0) {
      groups.push(new GroupItem("⚡  Skills", skills, "skill", "symbol-event"));
    }

    // ── Pending Review (draft / proposed needing attention) ────────────────
    const pending = all.filter(
      (m) => (m.status === "draft" || m.status === "proposed") && !m.requiresHumanApproval,
    );
    if (pending.length > 0) {
      groups.push(new GroupItem("🕐  Pending Review", pending, "pending", "circle-outline", true));
    }

    // ── This File ──────────────────────────────────────────────────────────
    const fileFilter = this.activeFileFilter;
    if (fileFilter) {
      const fileMemories = this.store.forFile(fileFilter);
      if (fileMemories.length > 0) {
        groups.push(
          new GroupItem(
            `📄 This File (${path.basename(fileFilter)})`,
            fileMemories,
            "file",
            "file-code",
          ),
        );
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
      if (m.type === "skill") continue; // already shown above
      if (!byType.has(m.type)) byType.set(m.type, []);
      byType.get(m.type)!.push(m);
    }

    for (const type of typeOrder) {
      const mems = byType.get(type);
      if (!mems || mems.length === 0) continue;
      const label = typeLabels[type] ?? type;
      const icon = TYPE_CODICON[type] ?? "note";
      groups.push(new GroupItem(label, mems, type, icon, mems.length > 5));
    }

    // Unknown types
    const knownTypes = new Set([...typeOrder, "skill", "session_recap"]);
    for (const [type, mems] of byType) {
      if (!knownTypes.has(type)) {
        groups.push(new GroupItem(`📝  ${type}`, mems, type, "note", true));
      }
    }

    return groups;
  }
}
