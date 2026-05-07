/**
 * hAIve VS Code Extension — entry point.
 *
 * Features:
 *  - Sidebar tree view: browse all memories grouped by type
 *  - CodeLens: inline memory count at the top of anchored files
 *  - Status bar: total memory count + action_required warning
 *  - File watcher: auto-reload when .ai/memories/ changes
 *  - Commands: open memory, show for file, refresh, add memory
 */
import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { MemoryStore } from "./memoryReader.js";
import { HaiveCodeLensProvider } from "./codeLensProvider.js";
import { HaiveTreeProvider } from "./treeProvider.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath;
}

function relativeToWorkspace(uri: vscode.Uri, root: string): string {
  return path.relative(root, uri.fsPath).replace(/\\/g, "/");
}

// ── Status bar ────────────────────────────────────────────────────────────────

function updateStatusBar(
  item: vscode.StatusBarItem,
  store: MemoryStore,
): void {
  const cfg = vscode.workspace.getConfiguration("haive");
  if (!cfg.get<boolean>("showStatusBar", true)) {
    item.hide();
    return;
  }

  if (!store.isInitialized()) {
    item.hide();
    return;
  }

  const total = store.getAll().length;
  const ar = store.actionRequiredCount();

  if (total === 0) {
    item.text = "$(book) hAIve: no memories";
    item.tooltip = "No hAIve memories found. Run `haive memory add` to add the first one.";
    item.backgroundColor = undefined;
  } else if (ar > 0) {
    item.text = `$(warning) hAIve: ${total} memories · ${ar} action required`;
    item.tooltip = `${ar} memory(ies) require human confirmation before the AI can act. Open the hAIve sidebar to review.`;
    item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  } else {
    item.text = `$(book) hAIve: ${total} ${total === 1 ? "memory" : "memories"}`;
    item.tooltip = "Click to open hAIve Memories panel";
    item.backgroundColor = undefined;
  }

  item.command = "haive.showMemoriesForFile";
  item.show();
}

// ── Activation ────────────────────────────────────────────────────────────────

export function activate(ctx: vscode.ExtensionContext): void {
  const root = getWorkspaceRoot();
  if (!root) return;
  const workspaceRoot = root;

  // ── Core store ─────────────────────────────────────────────────────────
  const store = new MemoryStore(workspaceRoot, () => {
    codeLensProvider.refresh();
    treeProvider.refresh();
    updateStatusBar(statusBarItem, store);
  });
  store.load();
  store.startWatcher();
  ctx.subscriptions.push({ dispose: () => store.dispose() });

  // ── CodeLens ───────────────────────────────────────────────────────────
  const codeLensProvider = new HaiveCodeLensProvider(store);
  ctx.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      { scheme: "file" },
      codeLensProvider,
    ),
  );

  // ── Tree view ──────────────────────────────────────────────────────────
  const treeProvider = new HaiveTreeProvider(store);
  const treeView = vscode.window.createTreeView("haive.memoriesView", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  ctx.subscriptions.push(treeView);

  // Update tree filter when active editor changes
  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.uri.scheme === "file") {
        const rel = relativeToWorkspace(editor.document.uri, workspaceRoot);
        treeProvider.filterToFile(rel);
        codeLensProvider.refresh();
      } else {
        treeProvider.clearFilter();
      }
    }),
  );

  // ── Status bar ─────────────────────────────────────────────────────────
  const statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    10,
  );
  updateStatusBar(statusBarItem, store);
  ctx.subscriptions.push(statusBarItem);

  // ── Decoration: warning gutter for action_required ─────────────────────
  const warningDecoration = vscode.window.createTextEditorDecorationType({
    gutterIconPath: ctx.asAbsolutePath("media/warning-gutter.svg"),
    gutterIconSize: "contain",
    overviewRulerColor: new vscode.ThemeColor("list.warningForeground"),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });

  function updateDecorations(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    const cfg = vscode.workspace.getConfiguration("haive");
    if (!cfg.get<boolean>("highlightActionRequired", true)) return;

    const rel = relativeToWorkspace(editor.document.uri, workspaceRoot);
    const hasThreat = store
      .forFile(rel)
      .some((m) => m.requiresHumanApproval);

    editor.setDecorations(
      warningDecoration,
      hasThreat ? [new vscode.Range(0, 0, 0, 0)] : [],
    );
  }

  ctx.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(updateDecorations),
  );
  ctx.subscriptions.push(warningDecoration);

  // Decorate the already-open editor on activation
  updateDecorations(vscode.window.activeTextEditor);

  // ── Commands ───────────────────────────────────────────────────────────

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.refreshMemories", () => {
      store.load();
      codeLensProvider.refresh();
      treeProvider.refresh();
      updateStatusBar(statusBarItem, store);
      vscode.window.setStatusBarMessage("$(check) hAIve: memories refreshed", 2000);
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      "haive.showMemoriesForFile",
      async (uri?: vscode.Uri) => {
        const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
        if (targetUri) {
          const rel = relativeToWorkspace(targetUri, workspaceRoot);
          treeProvider.filterToFile(rel);
        }
        await vscode.commands.executeCommand("haive.memoriesView.focus");
      },
    ),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand(
      "haive.openMemory",
      async (filePathOrUri: string | vscode.Uri) => {
        const uri =
          typeof filePathOrUri === "string"
            ? vscode.Uri.file(filePathOrUri)
            : filePathOrUri;
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, {
          preview: true,
          viewColumn: vscode.ViewColumn.Beside,
        });
      },
    ),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.copyMemoryBody", async (item) => {
      if (item?.memory?.body) {
        await vscode.env.clipboard.writeText(item.memory.body);
        vscode.window.setStatusBarMessage("$(check) Memory content copied", 2000);
      }
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.addMemory", async () => {
      // Quick-pick for memory type
      const type = await vscode.window.showQuickPick(
        ["gotcha", "convention", "architecture", "decision", "glossary"],
        { placeHolder: "Memory type", title: "hAIve: Add Memory" },
      );
      if (!type) return;

      const slug = await vscode.window.showInputBox({
        prompt: "Short slug (e.g. pg-pool-max-prod)",
        placeHolder: "memory-slug",
        validateInput: (v) =>
          /^[a-z0-9-]+$/.test(v) ? null : "Lowercase letters, numbers and hyphens only",
      });
      if (!slug) return;

      const body = await vscode.window.showInputBox({
        prompt: "Memory content (brief, actionable)",
        placeHolder: "Describe the gotcha, convention, or decision…",
      });
      if (!body) return;

      // Run haive memory add via CLI
      const cmd = `haive memory add --type ${type} --slug ${slug} --scope team --body "${body.replace(/"/g, '\\"')}"`;
      const terminal = vscode.window.createTerminal({ name: "hAIve", cwd: root });
      terminal.show();
      terminal.sendText(cmd);

      vscode.window.showInformationMessage(
        `hAIve: memory "${slug}" queued. Approve with \`haive memory approve ${new Date().toISOString().slice(0, 10)}-${type}-${slug}\``,
      );
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.init", () => {
      const terminal = vscode.window.createTerminal({ name: "hAIve Init", cwd: root });
      terminal.show();
      terminal.sendText("haive init");
    }),
  );

  // ── Config change listener ─────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("haive")) {
        codeLensProvider.refresh();
        treeProvider.refresh();
        updateStatusBar(statusBarItem, store);
      }
    }),
  );

  // ── Welcome notification on first activation ───────────────────────────
  const isNew = !store.isInitialized();
  if (isNew) {
    vscode.window
      .showInformationMessage(
        "hAIve is not initialized in this workspace.",
        "Initialize hAIve",
        "Learn More",
      )
      .then((choice) => {
        if (choice === "Initialize hAIve") {
          vscode.commands.executeCommand("haive.init");
        } else if (choice === "Learn More") {
          vscode.env.openExternal(vscode.Uri.parse("https://github.com/Doucs91/hAIve"));
        }
      });
  } else {
    const total = store.getAll().length;
    const ar = store.actionRequiredCount();
    if (ar > 0) {
      vscode.window
        .showWarningMessage(
          `hAIve: ${ar} memory(ies) require your attention before AI agents can act.`,
          "Review Now",
        )
        .then((choice) => {
          if (choice === "Review Now") {
            vscode.commands.executeCommand("haive.memoriesView.focus");
          }
        });
    }
  }
}

export function deactivate(): void {}
