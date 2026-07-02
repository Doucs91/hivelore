import * as vscode from "vscode";

/**
 * A small, non-actionable header row that explains the role of a Hivelore view.
 * Shows a one-line summary inline and the full explanation on hover (tooltip) — so every
 * section in the sidebar is self-describing without leaving the UI.
 */
export class InfoItem extends vscode.TreeItem {
  constructor(viewTitle: string, oneLiner: string, role: string) {
    super("About this view", vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon("info");
    this.description = oneLiner;
    this.contextValue = "haiveInfo";
    const md = new vscode.MarkdownString(`**${viewTitle}**\n\n${role}`);
    md.supportThemeIcons = true;
    this.tooltip = md;
  }
}

/** One-liner + full role text for each Hivelore view, keyed for reuse across providers. */
export const VIEW_ROLES = {
  memories: {
    oneLiner: "the repo's living knowledge",
    role:
      "The repo's living knowledge — conventions, decisions, gotchas, glossary, skills and attempts. " +
      "Each memory can anchor to files and carry a **sensor** that blocks a known mistake. " +
      "Items are grouped by urgency then by type. The badge after each memory shows how it was " +
      "validated: ✋ human (reviewed) · 🤖 AI (an agent approved it) · ⚙ auto (a rule trusted it, **unreviewed**).",
  },
  cockpit: {
    oneLiner: "high-level harness health",
    role:
      "A high-level health check of your harness — protection, context quality, corpus quality and " +
      "coverage scores, plus the top risks worth attention. Run the strategic check to populate it.",
  },
  inbox: {
    oneLiner: "what to fix now",
    role:
      "Concrete context-hygiene actions to do now: pending reviews, unanchored seeds, stale memories, " +
      "and sensors needing promotion. Work the list to keep the corpus healthy and the gate trustworthy.",
  },
  harness: {
    oneLiner: "maturity scores from hivelore doctor",
    role:
      "Per-dimension scores from `hivelore doctor` — protection, context, corpus and coverage — and the " +
      "findings behind them. A quick gauge of how mature and trustworthy your harness is.",
  },
} as const;
