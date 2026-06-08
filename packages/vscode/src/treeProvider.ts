import * as vscode from "vscode";
import * as path from "path";
import type { Memory, MemoryStore } from "./memoryReader.js";
import { InfoItem, VIEW_ROLES } from "./infoNode.js";

// What each group/section in the Context Policy view is for — shown on hover (role tooltip).
const GROUP_ROLE: Record<string, string> = {
  action_required:
    "Flagged `requires_human_approval` — the AI must NOT act on these alone. You confirm first (e.g. cross-repo breaking changes, dependency bumps).",
  skill: "Reusable playbooks the agent should follow for recurring tasks (feedforward harness guides).",
  pending: "Draft/proposed memories awaiting validation. Approve the good ones; reject the noise.",
  seeds:
    "Generic stack-pack seeds not yet anchored to your code — background priority until you curate them (anchor to a file or rewrite as a repo-specific note).",
  "ai-validated":
    "Validated by an AI agent (🤖) or an automatic rule (⚙), **not** by a human. Skim to confirm the knowledge is correct — auto-trust is not the same as reviewed.",
  file: "Memories anchored to the file currently open in the editor.",
  architecture: "Big-picture structure & boundaries — how the system fits together.",
  convention: "How things are done here — patterns to follow for consistency.",
  decision: "Choices made and the rationale (the why), so they aren't relitigated.",
  gotcha: "Known traps and surprising behaviors in this codebase; each can carry a sensor that catches a recurrence.",
  glossary: "Domain terms and what they mean in this codebase.",
  attempt: "Approaches that did not work out, each with the recommended alternative.",
};

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
    const count = `${memories.length} ${memories.length === 1 ? "memory" : "memories"}`;
    const role = GROUP_ROLE[groupKey];
    // Role tooltip: explain what this section is for, then the count.
    this.tooltip = role
      ? new vscode.MarkdownString(`**${label.trim()}**\n\n${role}\n\n_${count}_`)
      : count;
  }
}

export class MemoryItem extends vscode.TreeItem {
  constructor(public readonly memory: Memory) {
    super(memory.title, vscode.TreeItemCollapsibleState.None);

    const needsCuration = memory.isSeed && !memory.anchored;
    // `seedMemory` unlocks the "Anchor to file…" curation action in the context menu.
    this.contextValue = needsCuration ? "seedMemory" : "memory";

    const statusBadge = STATUS_BADGE[memory.status] ?? ` [${memory.status}]`;
    const seedBadge = needsCuration ? " 🌱 seed" : "";
    // Validation provenance: ✋ human-reviewed · 🤖 AI-approved · ⚙ auto (unreviewed).
    const PROV_INLINE: Record<string, string> = { human: " ✋", agent: " 🤖", auto: " ⚙" };
    const provBadge =
      memory.status === "validated" && memory.validatedBy ? (PROV_INLINE[memory.validatedBy] ?? "") : "";
    this.description = `${memory.scope}${statusBadge}${seedBadge}${provBadge}`;

    // Rich tooltip
    const lines: string[] = [
      `**${memory.type}** · ${memory.scope} · ${memory.status}`,
      "",
    ];
    if (memory.status === "validated" && memory.validatedBy) {
      const PROV_LABEL: Record<string, string> = {
        human: "✋ human (reviewed)",
        agent: "🤖 AI agent",
        auto: "⚙ auto-rule — not human-reviewed",
      };
      lines.push(`Validated by: ${PROV_LABEL[memory.validatedBy] ?? memory.validatedBy}`, "");
    }
    if (needsCuration) {
      lines.push(
        "🌱 _Generic stack-pack seed, not yet anchored._ Anchor it to a real file or replace it with a repo-specific note to raise it above background priority.",
        "",
      );
    }
    if (memory.tags.length) lines.push(`Tags: \`${memory.tags.join("`, `")}\``);
    if (memory.anchorPaths.length) lines.push(`Anchored: ${memory.anchorPaths.join(", ")}`);
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

type TreeNode = GroupItem | MemoryItem | InfoItem;

export class HaiveTreeProvider
  implements vscode.TreeDataProvider<TreeNode>
{
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    TreeNode | undefined | null | void
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

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (element instanceof MemoryItem || element instanceof InfoItem) return [];

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

    // ── Seeds needing curation (unanchored stack-pack seeds) ───────────────
    const seeds = this.store.seedsNeedingCuration();
    if (seeds.length > 0) {
      groups.push(
        new GroupItem("🌱  Seeds — needs curation", seeds, "seeds", "sparkle", true),
      );
    }

    // ── AI-validated — review? (trusted by an agent or an auto-rule, not a human) ──
    const aiValidated = all.filter(
      (m) => m.status === "validated" && (m.validatedBy === "agent" || m.validatedBy === "auto"),
    );
    if (aiValidated.length > 0) {
      groups.push(new GroupItem("🤖  AI-validated — review?", aiValidated, "ai-validated", "hubot", true));
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

    // Lead with the self-describing info row so the section's purpose is one hover away.
    const info = new InfoItem("Context Policy", VIEW_ROLES.memories.oneLiner, VIEW_ROLES.memories.role);
    return [info, ...groups];
  }
}
