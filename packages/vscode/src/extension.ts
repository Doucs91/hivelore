import * as vscode from "vscode";
import * as path from "path";
import * as cp from "child_process";
import { MemoryStore } from "./memoryReader.js";
import { HaiveCodeLensProvider } from "./codeLensProvider.js";
import { HaiveTreeProvider } from "./treeProvider.js";
import { HarnessHealthProvider, runHaive } from "./harnessHealth.js";
import { BriefingPanel } from "./briefingPanel.js";
import { ObservabilityProvider } from "./observabilityProvider.js";

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

  // ── Strategic observability views ──────────────────────────────────────
  const cockpitProvider = new ObservabilityProvider(workspaceRoot, outputChannel, "cockpit");
  const inboxProvider = new ObservabilityProvider(workspaceRoot, outputChannel, "inbox");
  const cockpitView = vscode.window.createTreeView("haive.cockpitView", {
    treeDataProvider: cockpitProvider,
    showCollapseAll: true,
  });
  const inboxView = vscode.window.createTreeView("haive.inboxView", {
    treeDataProvider: inboxProvider,
    showCollapseAll: true,
  });
  ctx.subscriptions.push(cockpitView, inboxView);

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

  // ── Strategic observability refresh ────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.refreshObservability", async () => {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: "hAIve: refreshing observability…" },
        async () => {
          const snapshot = await cockpitProvider.refreshData();
          if (snapshot) inboxProvider.useSnapshot(snapshot);
        },
      );
      await vscode.commands.executeCommand("haive.cockpitView.focus");
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
            const snapshot = await cockpitProvider.refreshData();
            if (snapshot) inboxProvider.useSnapshot(snapshot);
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
      let id = itemMemoryId(item);
      if (!id) {
        id = await vscode.window.showInputBox({ prompt: "Memory ID to approve", title: "hAIve: Approve Memory" });
      }
      if (!id) return;
      await runHaiveAction(["memory", "approve", id], `approved ${id}`);
    }),
  );

  // ── Reject memory ──────────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.rejectMemory", async (item?: { memory?: { id: string } }) => {
      let id = itemMemoryId(item);
      if (!id) {
        id = await vscode.window.showInputBox({ prompt: "Memory ID to reject", title: "hAIve: Reject Memory" });
      }
      if (!id) return;
      await runHaiveAction(["memory", "reject", id], `rejected ${id}`);
    }),
  );

  // ── Shared action runner (execFile + refresh) ──────────────────────────
  async function runHaiveAction(args: string[], successMsg: string): Promise<boolean> {
    try {
      const out = await runHaive(workspaceRoot, args);
      outputChannel.appendLine(`\n[haive ${args.join(" ")}] ${new Date().toLocaleTimeString()}`);
      outputChannel.appendLine(out);
      store.load();
      treeProvider.refresh();
      codeLensProvider.refresh();
      const snapshot = await cockpitProvider.refreshData();
      if (snapshot) inboxProvider.useSnapshot(snapshot);
      updateStatusBar(statusBarItem, store);
      vscode.window.setStatusBarMessage(`$(check) ${successMsg}`, 3000);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      outputChannel.appendLine(`[haive error] ${msg}`);
      outputChannel.show(true);
      vscode.window.showErrorMessage(`hAIve: ${msg}`);
      return false;
    }
  }

  async function openMemoryById(id: string | undefined): Promise<void> {
    if (!id) return;
    const memory = store.getAll().find((m) => m.id === id);
    if (!memory) {
      vscode.window.showWarningMessage(`hAIve: no local memory found for ${id}. Refresh memories and try again.`);
      return;
    }
    await vscode.commands.executeCommand("haive.openMemory", memory.filePath);
  }

  /** Resolve a memory id from a tree item, or let the user pick one. */
  async function resolveMemoryId(
    item: { memory?: { id: string } } | undefined,
    placeHolder: string,
    filter?: (m: ReturnType<MemoryStore["getAll"]>[number]) => boolean,
  ): Promise<string | undefined> {
    if (item?.memory?.id) return item.memory.id;
    const all = store.getAll().filter((m) => (filter ? filter(m) : true));
    if (all.length === 0) {
      vscode.window.showInformationMessage("hAIve: no matching memories.");
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      all.map((m) => ({
        label: m.title,
        description: `${m.scope}/${m.type}${m.status !== "validated" ? ` [${m.status}]` : ""}`,
        id: m.id,
      })),
      { placeHolder, matchOnDescription: true, title: "hAIve" },
    );
    return picked?.id;
  }

  function itemMemoryId(item: unknown): string | undefined {
    if (!item || typeof item !== "object") return undefined;
    const record = item as { memoryId?: string; sensorId?: string; memory?: { id?: string } };
    return record.memoryId ?? record.sensorId ?? record.memory?.id;
  }

  function itemActionArgs(item: unknown): string[] | undefined {
    if (!item || typeof item !== "object") return undefined;
    const record = item as { actionArgs?: string[] };
    return record.actionArgs;
  }

  // ── Observability routines and item actions ────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.openMemoryById", async (itemOrId?: unknown) => {
      const id = typeof itemOrId === "string" ? itemOrId : itemMemoryId(itemOrId);
      await openMemoryById(id);
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.runEval", async () => {
      await runHaiveAction(["eval"], "eval complete");
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.saveEvalBaseline", async () => {
      await runHaiveAction(["eval", "--baseline"], "eval baseline saved");
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.compareEval", async () => {
      await runHaiveAction(["eval", "--compare"], "eval comparison complete");
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.runSensorsCheck", async () => {
      await runHaiveAction(["sensors", "check"], "sensors check complete");
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.runMemoryLint", async () => {
      await runHaiveAction(["memory", "lint", "--fix"], "memory lint complete");
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.runFixAction", async (item?: unknown) => {
      const args = itemActionArgs(item);
      if (!args || args.length === 0) {
        vscode.window.showInformationMessage("hAIve: this item has no automatic fix.");
        return;
      }
      await runHaiveAction(args, `ran haive ${args.join(" ")}`);
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.markMemoryApplied", async (item?: unknown) => {
      const id = itemMemoryId(item);
      if (!id) return;
      await runHaiveAction(["memory", "feedback", id, "--applied"], `marked ${id} as applied`);
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.markMemoryRejected", async (item?: unknown) => {
      const id = itemMemoryId(item);
      if (!id) return;
      const reason = await vscode.window.showInputBox({
        title: "hAIve: Reject Memory Signal",
        prompt: "Why was this memory wrong, noisy, or unhelpful?",
        placeHolder: "Too generic / outdated / did not apply to this task",
      });
      if (reason === undefined) return;
      await runHaiveAction(["memory", "feedback", id, "--rejected", "--reason", reason], `marked ${id} as rejected`);
    }),
  );

  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.promoteSensor", async (item?: unknown) => {
      const id = itemMemoryId(item);
      if (!id) return;
      const choice = await vscode.window.showWarningMessage(
        `Promote sensor ${id} to block? This can hard-fail commits when it fires.`,
        { modal: true },
        "Promote",
      );
      if (choice !== "Promote") return;
      await runHaiveAction(["sensors", "promote", id, "--yes"], `promoted sensor ${id} to block`);
    }),
  );

  // ── Seed a stack pack ──────────────────────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.seedStackPack", async () => {
      let supported: string[] = [];
      let detected: string[] = [];
      try {
        const raw = await runHaive(workspaceRoot, ["memory", "seed", "--list", "--json"]);
        const parsed = JSON.parse(raw) as { supported?: string[]; detected?: string[] };
        supported = parsed.supported ?? [];
        detected = parsed.detected ?? [];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        vscode.window.showErrorMessage(`hAIve: could not list stacks (${msg}). Is hAIve initialized?`);
        return;
      }
      if (supported.length === 0) {
        vscode.window.showInformationMessage("hAIve: no stack packs available.");
        return;
      }

      const detectedSet = new Set(detected);
      const picks = [...supported]
        .sort((a, b) => Number(detectedSet.has(b)) - Number(detectedSet.has(a)) || a.localeCompare(b))
        .map((s) => ({
          label: detectedSet.has(s) ? `$(check) ${s}` : s,
          description: detectedSet.has(s) ? "detected in package.json" : "",
          value: s,
        }));

      const chosen = await vscode.window.showQuickPick(picks, {
        placeHolder: "Pick a stack to seed starter memories (kept at background priority until anchored)",
        title: "hAIve: Add Starter Memories",
        canPickMany: false,
      });
      if (!chosen) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `hAIve: seeding ${chosen.value}…` },
        () => runHaiveAction(["memory", "seed", chosen.value], `seeded ${chosen.value} starter memories`),
      );
    }),
  );

  // ── Anchor a memory (or seed) to a file ────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.anchorMemory", async (item?: { memory?: { id: string } }) => {
      const id = await resolveMemoryId(item, "Pick a memory to anchor to a file");
      if (!id) return;

      const choices: { label: string; value: string }[] = [];
      const activeUri = vscode.window.activeTextEditor?.document.uri;
      if (activeUri?.scheme === "file" && activeUri.fsPath.startsWith(workspaceRoot)) {
        const rel = relativeToWorkspace(activeUri, workspaceRoot);
        choices.push({ label: `$(file-code) Anchor to ${rel}`, value: rel });
      }
      choices.push({ label: "$(folder-opened) Choose a file…", value: "__pick__" });

      const pick = await vscode.window.showQuickPick(choices, {
        placeHolder: "Which file should this memory be anchored to?",
        title: "hAIve: Anchor Memory",
      });
      if (!pick) return;

      let rel = pick.value;
      if (rel === "__pick__") {
        const uris = await vscode.window.showOpenDialog({
          canSelectMany: false,
          openLabel: "Anchor here",
          defaultUri: vscode.Uri.file(workspaceRoot),
        });
        const picked = uris?.[0];
        if (!picked || !picked.fsPath.startsWith(workspaceRoot)) {
          if (picked) vscode.window.showWarningMessage("hAIve: pick a file inside this workspace.");
          return;
        }
        rel = relativeToWorkspace(picked, workspaceRoot);
      }

      await runHaiveAction(["memory", "update", id, "--paths", rel], `anchored ${id} to ${rel}`);
    }),
  );

  // ── Promote a memory (personal → team) ─────────────────────────────────
  ctx.subscriptions.push(
    vscode.commands.registerCommand("haive.promoteMemory", async (item?: { memory?: { id: string } }) => {
      const id = await resolveMemoryId(
        item,
        "Pick a personal memory to promote to the team",
        (m) => m.scope === "personal",
      );
      if (!id) return;
      await runHaiveAction(["memory", "promote", id], `promoted ${id} to team`);
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
