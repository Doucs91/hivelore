import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { MemoryStore } from "./memoryReader.js";
import { HaiveCodeLensProvider } from "./codeLensProvider.js";
import { HaiveTreeProvider } from "./treeProvider.js";
import { HarnessHealthProvider, runHaive } from "./harnessHealth.js";
import { BriefingPanel } from "./briefingPanel.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function relativeToWorkspace(uri: vscode.Uri, root: string): string {
  return path.relative(root, uri.fsPath).replace(/\\/g, "/");
}

// ── Status bar ────────────────────────────────────────────────────────────────

function updateStatusBar(item: vscode.StatusBarItem, store: MemoryStore): void {
  const cfg = vscode.workspace.getConfiguration("haive");
  if (!cfg.get<boolean>("showStatusBar", true) || !store.isInitialized()) {
    item.hide();
    return;
  }

  const total = store.getAll().length;
  const ar = store.actionRequiredCount();
  const pending = store.pendingCount();

  if (total === 0) {
    item.text = "$(book) hAIve: no memories";
    item.tooltip = "No hAIve memories found. Run `haive memory add` to add the first one.";
    item.backgroundColor = undefined;
  } else if (ar > 0) {
    item.text = `$(warning) hAIve: ${total} · ${ar} action required`;
    item.tooltip = `${ar} memory(ies) require human confirmation. Open the hAIve sidebar to review.`;
    item.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  } else if (pending > 0) {
    item.text = `$(circle-outline) hAIve: ${total} · ${pending} pending`;
    item.tooltip = `${pending} draft/proposed memory(ies) awaiting review.`;
    item.backgroundColor = undefined;
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

  const outputChannel = vscode.window.createOutputChannel("hAIve", "markdown");
  ctx.subscriptions.push(outputChannel);

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
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, codeLensProvider),
  );

  // ── Memories tree view ─────────────────────────────────────────────────
  const treeProvider = new HaiveTreeProvider(store);
  const treeView = vscode.window.createTreeView("haive.memoriesView", {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });
  ctx.subscriptions.push(treeView);

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

  // ── Harness Health tree view ────────────────────────────────────────────
  const healthProvider = new HarnessHealthProvider(workspaceRoot, outputChannel);
  const healthView = vscode.window.createTreeView("haive.harnessView", {
    treeDataProvider: healthProvider,
    showCollapseAll: false,
  });
  ctx.subscriptions.push(healthView);

  // ── Briefing panel ──────────────────────────────────────────────────────
  const briefingPanel = new BriefingPanel();
  ctx.subscriptions.push({ dispose: () => briefingPanel.dispose() });

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
  ctx.subscriptions.push(warningDecoration);

  function updateDecorations(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    const cfg = vscode.workspace.getConfiguration("haive");
    if (!cfg.get<boolean>("highlightActionRequired", true)) return;
    const rel = relativeToWorkspace(editor.document.uri, workspaceRoot);
    const hasThreat = store.forFile(rel).some((m) => m.requiresHumanApproval);
    editor.setDecorations(warningDecoration, hasThreat ? [new vscode.Range(0, 0, 0, 0)] : []);
  }

  ctx.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateDecorations));
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
    vscode.commands.registerCommand("haive.showMemoriesForFile", async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (targetUri) {
        const rel = relativeToWorkspace(targetUri, workspaceRoot);
        treeProvider.filterToFile(rel);
      }
      await vscode.commands.executeCommand("haive.memoriesView.focus");
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.showAllMemories", async () => {
      treeProvider.clearFilter();
      await vscode.commands.executeCommand("haive.memoriesView.focus");
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.openMemory", async (filePathOrUri: string | vscode.Uri) => {
      const uri = typeof filePathOrUri === "string" ? vscode.Uri.file(filePathOrUri) : filePathOrUri;
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.copyMemoryBody", async (item: { memory?: { body: string } }) => {
      if (item?.memory?.body) {
        await vscode.env.clipboard.writeText(item.memory.body);
        vscode.window.setStatusBarMessage("$(check) Memory content copied", 2000);
      }
    }),
  );

  // ── Search memories ────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.searchMemories", async () => {
      const all = store.getAll();
      if (all.length === 0) {
        vscode.window.showInformationMessage("No hAIve memories found in this workspace.");
        return;
      }

      const TYPE_ICON: Record<string, string> = {
        skill: "⚡", gotcha: "⚠️", decision: "🎯", architecture: "🏗",
        convention: "📐", glossary: "📖", attempt: "🔁",
      };

      const picks = all.map((m) => ({
        label: `${TYPE_ICON[m.type] ?? "📝"} ${m.title}`,
        description: `${m.scope}/${m.type}${m.status !== "validated" ? ` [${m.status}]` : ""}`,
        detail: m.tags.length ? `Tags: ${m.tags.join(", ")}` : undefined,
        memory: m,
      }));

      const selected = await vscode.window.showQuickPick(picks, {
        matchOnDescription: true,
        matchOnDetail: true,
        placeHolder: "Search memories by title, type, tags…",
        title: "hAIve: Search Memories",
      });

      if (selected) {
        await vscode.commands.executeCommand("haive.openMemory", selected.memory.filePath);
      }
    }),
  );

  // ── Add memory ────────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.addMemory", async () => {
      const TYPE_ITEMS = [
        { label: "⚡ skill", description: "Reusable procedure/playbook agents should follow", value: "skill" },
        { label: "⚠️ gotcha", description: "Non-obvious behavior that surprises newcomers", value: "gotcha" },
        { label: "🎯 decision", description: "A choice made and WHY (tradeoffs, constraints)", value: "decision" },
        { label: "📐 convention", description: "How things are done here (naming, patterns, tooling)", value: "convention" },
        { label: "🏗 architecture", description: "Structural overview of a system or module", value: "architecture" },
        { label: "📖 glossary", description: "Domain terms and their meaning in this codebase", value: "glossary" },
      ];

      const typeItem = await vscode.window.showQuickPick(TYPE_ITEMS, {
        placeHolder: "Select memory type",
        title: "hAIve: Add Memory (1/4)",
      });
      if (!typeItem) return;

      const slug = await vscode.window.showInputBox({
        prompt: "Short slug (kebab-case)",
        placeHolder: `${typeItem.value}-my-slug`,
        title: "hAIve: Add Memory (2/4)",
        validateInput: (v) =>
          /^[a-z0-9-]+$/.test(v) ? null : "Lowercase letters, numbers and hyphens only",
      });
      if (!slug) return;

      const body = await vscode.window.showInputBox({
        prompt: "Memory content — be brief and actionable",
        placeHolder: typeItem.value === "skill"
          ? "Step 1: … Step 2: … Step 3: …"
          : typeItem.value === "gotcha"
          ? "Non-obvious behavior: … Fix: …"
          : "Describe the " + typeItem.value + "…",
        title: "hAIve: Add Memory (3/4)",
      });
      if (!body) return;

      // Optionally anchor to the currently open file
      const activeFile = vscode.window.activeTextEditor?.document.uri;
      let anchorFlag = "";
      if (activeFile && activeFile.fsPath.startsWith(workspaceRoot)) {
        const rel = relativeToWorkspace(activeFile, workspaceRoot);
        const anchor = await vscode.window.showQuickPick(
          [
            { label: `$(file-code) Anchor to ${path.basename(rel)}`, value: rel },
            { label: "$(close) No anchor", value: "" },
          ],
          { placeHolder: "Anchor this memory to a source file?", title: "hAIve: Add Memory (4/4)" },
        );
        if (anchor?.value) anchorFlag = ` --paths "${anchor.value}"`;
      }

      const cmd = `haive memory add --type ${typeItem.value} --slug ${slug} --scope team --body "${body.replace(/"/g, '\\"')}"${anchorFlag}`;
      const terminal = vscode.window.createTerminal({ name: "hAIve", cwd: workspaceRoot });
      terminal.show();
      terminal.sendText(cmd);
    }),
  );

  // ── Memory Tried ────────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.memTried", async () => {
      const what = await vscode.window.showInputBox({
        prompt: "What did you try? (brief description)",
        placeHolder: "Used X approach for Y problem",
        title: "hAIve: Record Failed Attempt (1/2)",
      });
      if (!what) return;

      const why = await vscode.window.showInputBox({
        prompt: "Why did it fail?",
        placeHolder: "Failed because…",
        title: "hAIve: Record Failed Attempt (2/2)",
      });
      if (!why) return;

      const terminal = vscode.window.createTerminal({ name: "hAIve", cwd: workspaceRoot });
      terminal.show();
      terminal.sendText(`haive memory tried --what "${what.replace(/"/g, '\\"')}" --why "${why.replace(/"/g, '\\"')}"`);
    }),
  );

  // ── Run Briefing ────────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.runBriefing", async (uri?: vscode.Uri) => {
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      let relFile: string | undefined;
      if (targetUri?.scheme === "file") {
        relFile = relativeToWorkspace(targetUri, workspaceRoot);
      }

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "hAIve: loading briefing…" },
        () => briefingPanel.runForFile(workspaceRoot, relFile),
      );
    }),
  );

  // ── Run Doctor ─────────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.runDoctor", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "hAIve: running doctor…" },
        () => healthProvider.runDoctor(),
      );
      await vscode.commands.executeCommand("haive.harnessView.focus");
    }),
  );

  // ── Sync memories ───────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.syncMemories", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "hAIve: syncing…" },
        async () => {
          try {
            const out = await runHaive(workspaceRoot, ["sync"]);
            outputChannel.appendLine(`\n[haive sync] ${new Date().toLocaleTimeString()}`);
            outputChannel.appendLine(out);
            store.load();
            treeProvider.refresh();
            updateStatusBar(statusBarItem, store);
            vscode.window.setStatusBarMessage("$(check) hAIve: sync complete", 3000);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            outputChannel.appendLine(`[haive sync error] ${msg}`);
            outputChannel.show(true);
            vscode.window.showErrorMessage(`hAIve sync failed: ${msg}`);
          }
        },
      );
    }),
  );

  // ── Approve memory ─────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.approveMemory", async (item?: { memory?: { id: string } }) => {
      let id = item?.memory?.id;
      if (!id) {
        id = await vscode.window.showInputBox({ prompt: "Memory ID to approve", title: "hAIve: Approve Memory" });
      }
      if (!id) return;
      const terminal = vscode.window.createTerminal({ name: "hAIve", cwd: workspaceRoot });
      terminal.show();
      terminal.sendText(`haive memory approve ${id}`);
    }),
  );

  // ── Reject memory ──────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.rejectMemory", async (item?: { memory?: { id: string } }) => {
      let id = item?.memory?.id;
      if (!id) {
        id = await vscode.window.showInputBox({ prompt: "Memory ID to reject", title: "hAIve: Reject Memory" });
      }
      if (!id) return;
      const terminal = vscode.window.createTerminal({ name: "hAIve", cwd: workspaceRoot });
      terminal.show();
      terminal.sendText(`haive memory reject ${id}`);
    }),
  );

  // ── Init ───────────────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.init", () => {
      const terminal = vscode.window.createTerminal({ name: "hAIve Init", cwd: workspaceRoot });
      terminal.show();
      terminal.sendText("haive init");
    }),
  );

  // ── Show output ────────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.showOutput", () => {
      outputChannel.show();
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

  // ── Welcome / action-required notification ────────────────────────────
  if (!store.isInitialized()) {
    vscode.window
      .showInformationMessage(
        "hAIve is not initialized in this workspace.",
        "Initialize hAIve",
        "Learn More",
      )
      .then((choice) => {
        if (choice === "Initialize hAIve") vscode.commands.executeCommand("haive.init");
        else if (choice === "Learn More")
          vscode.env.openExternal(vscode.Uri.parse("https://github.com/Doucs91/hAIve"));
      });
  } else {
    const ar = store.actionRequiredCount();
    if (ar > 0) {
      vscode.window
        .showWarningMessage(
          `hAIve: ${ar} memory(ies) require your attention before AI agents can act.`,
          "Review Now",
        )
        .then((choice) => {
          if (choice === "Review Now") vscode.commands.executeCommand("haive.memoriesView.focus");
        });
    }
  }
}

export function deactivate(): void {}
