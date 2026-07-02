import * as vscode from "vscode";
import { runHaive } from "./harnessHealth.js";
import { InfoItem, VIEW_ROLES } from "./infoNode.js";

type Severity = "error" | "warn" | "info";

interface DoctorScores {
  protection_score: number;
  context_quality_score: number;
  corpus_quality_score: number;
  harness_coverage_score: number;
}

interface DoctorFinding {
  section: string;
  severity: Severity;
  code: string;
  message: string;
  fix?: string;
}

interface DoctorJson {
  scores?: DoctorScores;
  findings?: DoctorFinding[];
  next_actions?: string[];
}

interface DashboardJson {
  inventory?: {
    total: number;
    session_recaps: number;
    active: number;
    retired: number;
  };
  impact?: {
    total: number;
    high: number;
    medium: number;
    low: number;
    dormant: number;
    prune_candidates: number;
    top?: ImpactRow[];
  };
  sensors?: {
    total: number;
    warn: number;
    block: number;
    autogen: number;
    fired: number;
  };
  health?: {
    stale: number;
    retired: number;
    anchorless: number;
    pending: number;
    prune_candidates: number;
  };
  decay?: {
    decaying: number;
  };
  corpus?: {
    memory_files: number;
    est_tokens: number;
  };
}

interface EvalJson {
  report?: {
    retrieval?: {
      cases?: Array<{ name: string; misses?: string[] }>;
      mean_precision: number;
      mean_recall: number;
      mrr: number;
    } | null;
    sensors?: {
      cases?: Array<{ name: string; misses?: string[] }>;
      catch_rate: number;
    } | null;
    score: number;
  };
  delta?: {
    score?: { baseline: number; current: number; delta: number };
    regressed?: boolean;
    improved?: boolean;
  };
}

interface StatsJson {
  total?: number;
  by_tool?: Array<{ tool: string; count: number; last_used: string }>;
  window_start?: string | null;
  window_end?: string | null;
}

interface ImpactRow {
  id: string;
  type?: string;
  scope?: string;
  status?: string;
  impact?: {
    score: number;
    tier: string;
    signals: string[];
    pruneCandidate: boolean;
  };
  score?: number;
  tier?: string;
  signals?: string[];
  prune_candidate?: boolean;
}

interface ImpactJson {
  summary?: {
    total: number;
    high: number;
    medium: number;
    low: number;
    dormant: number;
    prune_candidates: number;
  };
  rows?: ImpactRow[];
}

interface SensorJson {
  id: string;
  severity: "warn" | "block";
  paths?: string[];
  message?: string;
  autogen?: boolean;
  last_fired?: string | null;
}

interface LintJson {
  findings_count?: number;
  findings?: Array<{
    id?: string;
    file?: string;
    severity: Severity;
    code: string;
    message: string;
  }>;
}

export interface ObservabilitySnapshot {
  doctor: DoctorJson | null;
  dashboard: DashboardJson | null;
  evalReport: EvalJson | null;
  stats: StatsJson | null;
  impact: ImpactJson | null;
  sensors: SensorJson[];
  lint: LintJson | null;
  errors: string[];
  generatedAt: Date;
}

export type ObservabilityMode = "cockpit" | "inbox";

export class ObservabilityItem extends vscode.TreeItem {
  readonly memoryId?: string;
  readonly sensorId?: string;
  readonly actionArgs?: string[];

  constructor(
    label: string,
    options: {
      description?: string;
      detail?: string;
      icon?: string;
      color?: string;
      contextValue?: string;
      collapsibleState?: vscode.TreeItemCollapsibleState;
      children?: ObservabilityItem[];
      command?: vscode.Command;
      memoryId?: string;
      sensorId?: string;
      actionArgs?: string[];
    } = {},
  ) {
    super(label, options.collapsibleState ?? vscode.TreeItemCollapsibleState.None);
    this.description = options.description;
    this.contextValue = options.contextValue;
    this.command = options.command;
    this.memoryId = options.memoryId;
    this.sensorId = options.sensorId;
    this.actionArgs = options.actionArgs;
    if (options.detail) this.tooltip = new vscode.MarkdownString(options.detail);
    if (options.children) this.children = options.children;
    if (options.icon) {
      this.iconPath = new vscode.ThemeIcon(
        options.icon,
        options.color ? new vscode.ThemeColor(options.color) : undefined,
      );
    }
  }

  children?: ObservabilityItem[];
}

export class ObservabilityProvider implements vscode.TreeDataProvider<ObservabilityItem | InfoItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ObservabilityItem | InfoItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private snapshot: ObservabilitySnapshot | null = null;
  private loading = false;

  constructor(
    private readonly workspaceRoot: string,
    private readonly outputChannel: vscode.OutputChannel,
    private readonly mode: ObservabilityMode,
  ) {}

  async refreshData(): Promise<ObservabilitySnapshot | null> {
    if (this.loading) return this.snapshot;
    this.loading = true;
    this._onDidChangeTreeData.fire();

    const started = new Date();
    const [doctor, dashboard, evalReport, stats, impact, sensors, lint] = await Promise.all([
      this.readJson<DoctorJson>(["doctor", "--json"], "doctor"),
      this.readJson<DashboardJson>(["dashboard", "--json"], "dashboard"),
      this.readEval(),
      this.readJson<StatsJson>(["stats", "--json"], "stats"),
      this.readJson<ImpactJson>(["memory", "impact", "--json"], "memory impact"),
      this.readJson<SensorJson[]>(["sensors", "list", "--json"], "sensors list"),
      this.readJson<LintJson>(["memory", "lint", "--fix", "--json"], "memory lint"),
    ]);

    const errors = [doctor, dashboard, evalReport, stats, impact, sensors, lint]
      .filter((x): x is { error: string } => Boolean(x && "error" in x))
      .map((x) => x.error);

    this.snapshot = {
      doctor: valueOrNull(doctor),
      dashboard: valueOrNull(dashboard),
      evalReport: valueOrNull(evalReport),
      stats: valueOrNull(stats),
      impact: valueOrNull(impact),
      sensors: valueOrNull(sensors) ?? [],
      lint: valueOrNull(lint),
      errors,
      generatedAt: started,
    };
    this.loading = false;
    this._onDidChangeTreeData.fire();
    return this.snapshot;
  }

  useSnapshot(snapshot: ObservabilitySnapshot): void {
    this.snapshot = snapshot;
    this.loading = false;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ObservabilityItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ObservabilityItem | InfoItem): (ObservabilityItem | InfoItem)[] {
    if (element instanceof ObservabilityItem && element.children) return element.children;
    if (element) return [];

    if (this.loading) {
      return [new ObservabilityItem("Loading Hivelore observability...", { icon: "loading~spin" })];
    }

    const r = this.mode === "cockpit" ? VIEW_ROLES.cockpit : VIEW_ROLES.inbox;
    const info = new InfoItem(this.mode === "cockpit" ? "Strategic Cockpit" : "Discipline Inbox", r.oneLiner, r.role);

    if (!this.snapshot) {
      return [
        info,
        new ObservabilityItem(this.mode === "cockpit" ? "Run strategic check" : "Build discipline inbox", {
          icon: "play",
          command: {
            command: "hivelore.refreshObservability",
            title: "Refresh Hivelore Observability",
          },
        }),
      ];
    }

    const items = this.mode === "cockpit" ? buildCockpitItems(this.snapshot) : buildInboxItems(this.snapshot);
    return [info, ...items];
  }

  private async readEval(): Promise<EvalJson | { error: string } | null> {
    const compared = await this.readJson<EvalJson>(["eval", "--compare", "--json"], "eval compare", false);
    if (compared && !("error" in compared)) return compared;
    return this.readJson<EvalJson>(["eval", "--json"], "eval");
  }

  private async readJson<T>(
    args: string[],
    label: string,
    logError = true,
  ): Promise<T | { error: string } | null> {
    try {
      const raw = await runHaive(this.workspaceRoot, args);
      this.outputChannel.appendLine(`\n[hivelore ${args.join(" ")}] ${new Date().toLocaleTimeString()}`);
      this.outputChannel.appendLine(raw.slice(0, 20_000));
      return JSON.parse(raw) as T;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (logError) this.outputChannel.appendLine(`[hivelore ${label} error] ${msg}`);
      return { error: `${label}: ${msg}` };
    }
  }
}

function valueOrNull<T>(value: T | { error: string } | null): T | null {
  if (!value) return null;
  if (typeof value === "object" && "error" in value) return null;
  return value;
}

function buildCockpitItems(snapshot: ObservabilitySnapshot): ObservabilityItem[] {
  const doctor = snapshot.doctor;
  const dashboard = snapshot.dashboard;
  const evalReport = snapshot.evalReport?.report;
  const stats = snapshot.stats;
  const impact = snapshot.impact?.summary ?? dashboard?.impact;
  const sensors = dashboard?.sensors;
  const health = dashboard?.health;
  const corpus = dashboard?.corpus;

  const qualityChildren = [
    scoreItem("Protection", doctor?.scores?.protection_score),
    scoreItem("Context quality", doctor?.scores?.context_quality_score),
    scoreItem("Corpus quality", doctor?.scores?.corpus_quality_score),
    scoreItem("Harness coverage", doctor?.scores?.harness_coverage_score),
    scoreItem("Eval score", evalReport?.score),
  ];

  const retrieval = evalReport?.retrieval;
  const sensorEval = evalReport?.sensors;
  const evalChildren = [
    metricItem("Retrieval recall", percent(retrieval?.mean_recall), "target"),
    metricItem("Retrieval precision", percent(retrieval?.mean_precision), "symbol-number"),
    metricItem("MRR", numberText(retrieval?.mrr), "list-ordered"),
    metricItem("Sensor catch-rate", percent(sensorEval?.catch_rate), "shield"),
  ];
  const delta = snapshot.evalReport?.delta;
  if (delta?.score) {
    evalChildren.push(
      metricItem(
        "Baseline delta",
        `${delta.score.current} vs ${delta.score.baseline} (${signed(delta.score.delta)})`,
        delta.regressed ? "arrow-down" : delta.improved ? "arrow-up" : "dash",
        delta.regressed ? "list.errorForeground" : undefined,
      ),
    );
  }

  const corpusChildren = [
    metricItem("Policy memories", String(dashboard?.inventory?.total ?? "?"), "book"),
    metricItem("Active / retired", `${dashboard?.inventory?.active ?? "?"} / ${dashboard?.inventory?.retired ?? "?"}`, "archive"),
    metricItem("Estimated tokens", corpus?.est_tokens ? `~${corpus.est_tokens.toLocaleString()}` : "?", "symbol-number"),
    metricItem("Pending", String(health?.pending ?? "?"), "circle-outline", health?.pending ? "list.warningForeground" : undefined),
    metricItem("Stale", String(health?.stale ?? "?"), "warning", health?.stale ? "list.warningForeground" : undefined),
    metricItem("Anchorless", String(health?.anchorless ?? "?"), "debug-disconnect", health?.anchorless ? "list.warningForeground" : undefined),
  ];

  const impactChildren = [
    metricItem("High / medium / low", `${impact?.high ?? "?"} / ${impact?.medium ?? "?"} / ${impact?.low ?? "?"}`, "graph"),
    metricItem("Dormant", String(impact?.dormant ?? "?"), "watch"),
    metricItem("Prune candidates", String(impact?.prune_candidates ?? "?"), "trash", impact?.prune_candidates ? "list.warningForeground" : undefined),
    ...topImpactRows(snapshot).slice(0, 6).map((row) => memoryImpactItem(row)),
  ];

  const sensorChildren = [
    metricItem("Total", String(sensors?.total ?? snapshot.sensors.length), "shield"),
    metricItem("Block / warn", `${sensors?.block ?? countSensors(snapshot.sensors, "block")} / ${sensors?.warn ?? countSensors(snapshot.sensors, "warn")}`, "shield"),
    metricItem("Autogen", String(sensors?.autogen ?? snapshot.sensors.filter((s) => s.autogen).length), "sparkle"),
    metricItem("Fired", String(sensors?.fired ?? snapshot.sensors.filter((s) => s.last_fired).length), "flame", sensors?.fired ? "testing.iconPassed" : undefined),
    ...snapshot.sensors.slice(0, 5).map((sensor) => sensorItem(sensor)),
  ];

  const usageChildren = (stats?.by_tool ?? []).slice(0, 8).map((tool) =>
    metricItem(tool.tool, `${tool.count} calls`, "terminal", undefined, `Last used: ${tool.last_used}`),
  );
  if (stats?.total !== undefined) {
    usageChildren.unshift(metricItem("Total calls", String(stats.total), "pulse"));
  }

  const riskChildren = buildRiskItems(snapshot);

  return [
    section("Quality gates", qualityChildren, "pass"),
    section("Eval and noise", evalChildren, "beaker"),
    section("Corpus health", corpusChildren, "database"),
    section("Memory impact", impactChildren, "graph"),
    section("Sensors", sensorChildren, "shield"),
    section("Tool usage", usageChildren, "pulse"),
    section("Strategic attention", riskChildren, riskChildren.length ? "warning" : "pass"),
    footer(snapshot),
  ];
}

function buildInboxItems(snapshot: ObservabilitySnapshot): ObservabilityItem[] {
  const items: ObservabilityItem[] = [];

  for (const finding of snapshot.doctor?.findings ?? []) {
    items.push(
      new ObservabilityItem(finding.message, {
        description: finding.code,
        detail: finding.fix ? `${finding.section}\n\nFix:\n${finding.fix}` : finding.section,
        icon: iconForSeverity(finding.severity),
        color: colorForSeverity(finding.severity),
        contextValue: finding.fix ? "haiveFixAction" : "haiveInfoAction",
        actionArgs: finding.fix ? fixToArgs(finding.fix) : undefined,
      }),
    );
  }

  for (const finding of snapshot.lint?.findings ?? []) {
    items.push(
      new ObservabilityItem(finding.message, {
        description: `lint ${finding.code}`,
        detail: finding.file ?? finding.id ?? "",
        icon: iconForSeverity(finding.severity),
        color: colorForSeverity(finding.severity),
        contextValue: finding.id ? "haiveMemoryAction" : "haiveInfoAction",
        memoryId: finding.id,
        command: finding.id
          ? { command: "hivelore.openMemoryById", title: "Open Memory", arguments: [finding.id] }
          : undefined,
      }),
    );
  }

  for (const row of pruneRows(snapshot)) {
    items.push(
      new ObservabilityItem(row.id, {
        description: "prune candidate",
        detail: impactDetail(row),
        icon: "trash",
        color: "list.warningForeground",
        contextValue: "haiveMemoryAction",
        memoryId: row.id,
        command: { command: "hivelore.openMemoryById", title: "Open Memory", arguments: [row.id] },
      }),
    );
  }

  for (const row of neverAppliedRows(snapshot).slice(0, 8)) {
    items.push(
      new ObservabilityItem(row.id, {
        description: "read often, never applied",
        detail: impactDetail(row),
        icon: "question",
        contextValue: "haiveMemoryFeedbackAction",
        memoryId: row.id,
        command: { command: "hivelore.openMemoryById", title: "Open Memory", arguments: [row.id] },
      }),
    );
  }

  for (const sensor of snapshot.sensors.filter((s) => s.autogen || s.severity === "warn").slice(0, 8)) {
    items.push(
      new ObservabilityItem(sensor.id, {
        description: sensor.autogen ? "autogen sensor needs review" : "warn sensor",
        detail: sensor.message ?? "",
        icon: sensor.autogen ? "sparkle" : "shield",
        contextValue: "haiveSensorAction",
        memoryId: sensor.id,
        sensorId: sensor.id,
        command: { command: "hivelore.openMemoryById", title: "Open Memory", arguments: [sensor.id] },
      }),
    );
  }

  const retrievalMisses = snapshot.evalReport?.report?.retrieval?.cases
    ?.filter((c) => (c.misses ?? []).length > 0) ?? [];
  for (const miss of retrievalMisses.slice(0, 5)) {
    items.push(
      new ObservabilityItem(miss.name, {
        description: "retrieval miss",
        detail: `Missed: ${(miss.misses ?? []).join(", ")}`,
        icon: "debug-breakpoint-data-unverified",
        color: "list.warningForeground",
      }),
    );
  }

  const sensorMisses = snapshot.evalReport?.report?.sensors?.cases
    ?.filter((c) => (c.misses ?? []).length > 0) ?? [];
  for (const miss of sensorMisses.slice(0, 5)) {
    items.push(
      new ObservabilityItem(miss.name, {
        description: "sensor miss",
        detail: `Missed: ${(miss.misses ?? []).join(", ")}`,
        icon: "shield",
        color: "list.errorForeground",
      }),
    );
  }

  if (items.length === 0) {
    items.push(new ObservabilityItem("Inbox clean", {
      description: "no discipline actions",
      icon: "pass",
      color: "testing.iconPassed",
    }));
  }

  return [
    section("Do next", items, items.length ? "list-selection" : "pass", false),
    section("One-click routines", routineItems(), "checklist", false),
    footer(snapshot),
  ];
}

function routineItems(): ObservabilityItem[] {
  return [
    commandItem("Run health check", "hivelore.runDoctor", "pulse"),
    commandItem("Run eval", "hivelore.runEval", "beaker"),
    commandItem("Save eval baseline", "hivelore.saveEvalBaseline", "bookmark"),
    commandItem("Run sensors check", "hivelore.runSensorsCheck", "shield"),
    commandItem("Run memory lint", "hivelore.runMemoryLint", "wand"),
    commandItem("Record failed attempt", "hivelore.memTried", "debug-restart"),
    commandItem("Add memory for current file", "hivelore.addMemory", "add"),
  ];
}

function buildRiskItems(snapshot: ObservabilitySnapshot): ObservabilityItem[] {
  const risks: ObservabilityItem[] = [];
  const health = snapshot.dashboard?.health;
  const precision = snapshot.evalReport?.report?.retrieval?.mean_precision;
  const fired = snapshot.dashboard?.sensors?.fired ?? snapshot.sensors.filter((s) => s.last_fired).length;

  if (health?.pending) risks.push(metricItem("Pending memories need review", String(health.pending), "circle-outline", "list.warningForeground"));
  if (health?.stale) risks.push(metricItem("Stale memories need refresh", String(health.stale), "warning", "list.warningForeground"));
  if (health?.anchorless) risks.push(metricItem("Anchorless policy cannot detect drift", String(health.anchorless), "debug-disconnect", "list.warningForeground"));
  if (health?.prune_candidates) risks.push(metricItem("Prune candidates", String(health.prune_candidates), "trash", "list.warningForeground"));
  if (precision !== undefined && precision < 0.25) {
    risks.push(metricItem("Briefing precision is noisy", percent(precision), "symbol-number", "list.warningForeground"));
  }
  if (snapshot.sensors.length > 0 && fired === 0) {
    risks.push(metricItem("No sensor has fired in local history", "review real-world coverage", "shield"));
  }
  for (const error of snapshot.errors) {
    risks.push(new ObservabilityItem(error, { icon: "error", color: "list.errorForeground" }));
  }
  if (risks.length === 0) risks.push(metricItem("No immediate risk", "clean", "pass", "testing.iconPassed"));
  return risks;
}

function section(label: string, children: ObservabilityItem[], icon: string, collapsed = true): ObservabilityItem {
  return new ObservabilityItem(label, {
    description: String(children.length),
    icon,
    collapsibleState: collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
    children,
  });
}

function scoreItem(label: string, score: number | undefined): ObservabilityItem {
  const value = score === undefined ? "?" : `${score}%`;
  const icon = score === undefined ? "question" : score >= 90 ? "pass" : score >= 70 ? "warning" : "error";
  const color = score === undefined
    ? undefined
    : score >= 90
    ? "testing.iconPassed"
    : score >= 70
    ? "list.warningForeground"
    : "list.errorForeground";
  return metricItem(label, value, icon, color);
}

function metricItem(
  label: string,
  description: string,
  icon: string,
  color?: string,
  detail?: string,
): ObservabilityItem {
  return new ObservabilityItem(label, { description, icon, color, detail });
}

function commandItem(label: string, command: string, icon: string): ObservabilityItem {
  return new ObservabilityItem(label, {
    icon,
    command: { command, title: label },
  });
}

function memoryImpactItem(row: ImpactRow): ObservabilityItem {
  const impact = normalizeImpact(row);
  return new ObservabilityItem(row.id, {
    description: `${impact.score.toFixed(2)} ${impact.tier}`,
    detail: impactDetail(row),
    icon: impact.pruneCandidate ? "trash" : impact.tier === "high" ? "star-full" : "graph",
    color: impact.pruneCandidate ? "list.warningForeground" : undefined,
    contextValue: "haiveMemoryFeedbackAction",
    memoryId: row.id,
    command: { command: "hivelore.openMemoryById", title: "Open Memory", arguments: [row.id] },
  });
}

function sensorItem(sensor: SensorJson): ObservabilityItem {
  return new ObservabilityItem(sensor.id, {
    description: `${sensor.severity}${sensor.autogen ? " autogen" : ""}`,
    detail: sensor.message ?? sensor.paths?.join(", ") ?? "",
    icon: sensor.severity === "block" ? "shield" : "shield",
    color: sensor.severity === "block" ? "list.errorForeground" : undefined,
    contextValue: "haiveSensorAction",
    memoryId: sensor.id,
    sensorId: sensor.id,
    command: { command: "hivelore.openMemoryById", title: "Open Memory", arguments: [sensor.id] },
  });
}

function footer(snapshot: ObservabilitySnapshot): ObservabilityItem {
  return new ObservabilityItem("Last refreshed", {
    description: snapshot.generatedAt.toLocaleTimeString(),
    icon: "clock",
    contextValue: "haiveRefreshAction",
  });
}

function topImpactRows(snapshot: ObservabilitySnapshot): ImpactRow[] {
  const rows = snapshot.impact?.rows;
  if (rows && rows.length > 0) return rows;
  return snapshot.dashboard?.impact?.top ?? [];
}

function pruneRows(snapshot: ObservabilitySnapshot): ImpactRow[] {
  return topImpactRows(snapshot).filter((row) => normalizeImpact(row).pruneCandidate);
}

function neverAppliedRows(snapshot: ObservabilitySnapshot): ImpactRow[] {
  return topImpactRows(snapshot)
    .filter((row) => {
      const impact = normalizeImpact(row);
      return !impact.pruneCandidate &&
        impact.signals.some((s) => s.startsWith("read ")) &&
        !impact.signals.some((s) => s.startsWith("applied ")) &&
        impact.score >= 0.3;
    });
}

function normalizeImpact(row: ImpactRow): { score: number; tier: string; signals: string[]; pruneCandidate: boolean } {
  return {
    score: row.impact?.score ?? row.score ?? 0,
    tier: row.impact?.tier ?? row.tier ?? "low",
    signals: row.impact?.signals ?? row.signals ?? [],
    pruneCandidate: row.impact?.pruneCandidate ?? row.prune_candidate ?? false,
  };
}

function impactDetail(row: ImpactRow): string {
  const impact = normalizeImpact(row);
  const bits = [
    `Impact: ${impact.score.toFixed(3)} (${impact.tier})`,
    row.type ? `Type: ${row.type}` : "",
    row.scope ? `Scope: ${row.scope}` : "",
    row.status ? `Status: ${row.status}` : "",
    impact.signals.length ? `Signals: ${impact.signals.join(", ")}` : "",
  ].filter(Boolean);
  return bits.join("\n");
}

function percent(value: number | undefined): string {
  if (value === undefined) return "?";
  return `${Math.round(value * 100)}%`;
}

function numberText(value: number | undefined): string {
  return value === undefined ? "?" : value.toFixed(3);
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function countSensors(sensors: SensorJson[], severity: "warn" | "block"): number {
  return sensors.filter((sensor) => sensor.severity === severity).length;
}

function iconForSeverity(severity: Severity): string {
  if (severity === "error") return "error";
  if (severity === "warn") return "warning";
  return "info";
}

function colorForSeverity(severity: Severity): string | undefined {
  if (severity === "error") return "list.errorForeground";
  if (severity === "warn") return "list.warningForeground";
  return undefined;
}

function fixToArgs(fix: string): string[] | undefined {
  const first = fix.split("\n").map((line) => line.trim()).find((line) => line.startsWith("hivelore ") || line.startsWith("haive "));
  if (!first) return undefined;
  return first
    .replace(/\s+#.*$/, "")
    .replace(/^(?:hivelore|haive)\s+/, "")
    .split(/\s+/)
    .filter(Boolean);
}
