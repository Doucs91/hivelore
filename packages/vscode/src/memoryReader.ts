/**
 * Memory reader — parses .ai/memories/**\/*.md files directly without
 * depending on @hiveai/core so the extension stays lightweight.
 */
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

export type MemoryType =
  | "skill"
  | "architecture"
  | "convention"
  | "decision"
  | "gotcha"
  | "glossary"
  | "attempt"
  | "session_recap"
  | string;

export type MemoryScope = "team" | "personal" | "module" | "shared" | string;

export interface Memory {
  id: string;
  title: string;
  type: MemoryType;
  scope: MemoryScope;
  status: string;
  tags: string[];
  anchorPaths: string[];
  /** True when anchored to at least one file path (anchors drive staleness + high-signal ranking). */
  anchored: boolean;
  /** True when this is a generic stack-pack seed (tag `stack-pack`) — background until curated. */
  isSeed: boolean;
  requiresHumanApproval: boolean;
  /** Who/what last validated this memory: "human" | "agent" | "auto" | null (not validated / legacy). */
  validatedBy: "human" | "agent" | "auto" | null;
  body: string;
  filePath: string;
  createdAt: string;
  readCount: number;
  module?: string;
  domain?: string;
}

// ── Frontmatter parser (handles the specific hAIve YAML subset) ────────────

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };

  const fmRaw = match[1]!;
  const body = (match[2] ?? "").trim();
  const fm: Record<string, unknown> = {};

  let i = 0;
  const lines = fmRaw.split("\n");

  while (i < lines.length) {
    const line = lines[i]!;
    const keyMatch = line.match(/^(\w[\w_]*):\s*(.*)/);
    if (!keyMatch) { i++; continue; }

    const key = keyMatch[1]!;
    const val = keyMatch[2]!.trim();

    if (val === "" || val === null) {
      // Check if next lines are a list or nested object
      const nested: string[] = [];
      i++;
      while (i < lines.length && (lines[i]!.startsWith("  ") || lines[i]!.startsWith("\t"))) {
        const nestedLine = lines[i]!.trimStart();
        if (nestedLine.startsWith("- ")) {
          nested.push(nestedLine.slice(2).trim().replace(/^['"]|['"]$/g, ""));
        } else {
          // Nested key-value (e.g. anchor: → paths:)
          const nkv = nestedLine.match(/^(\w[\w_]*):\s*(.*)/);
          if (nkv) {
            // Collect sub-list
            const subKey = nkv[1]!;
            const subList: string[] = [];
            i++;
            while (i < lines.length && (lines[i]!.startsWith("    ") || lines[i]!.startsWith("\t  "))) {
              const sl = lines[i]!.trimStart();
              if (sl.startsWith("- ")) subList.push(sl.slice(2).trim().replace(/^['"]|['"]$/g, ""));
              i++;
            }
            if (subList.length > 0) {
              // Merge sub-lists into parent key (e.g. anchor.paths → paths)
              fm[subKey] = subList;
            }
            continue;
          }
        }
        i++;
      }
      if (nested.length > 0) fm[key] = nested;
      continue;
    }

    // Inline value
    if (val === "true") fm[key] = true;
    else if (val === "false") fm[key] = false;
    else if (val === "null" || val === "~") fm[key] = null;
    else fm[key] = val.replace(/^['"]|['"]$/g, "");
    i++;
  }

  return { fm, body };
}

function parseMemoryFile(filePath: string): Memory | null {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const { fm, body } = parseFrontmatter(raw);
  if (!fm["id"]) return null;

  // Extract title from first heading in body
  const titleMatch = body.match(/^#{1,3}\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1]! : String(fm["id"]);

  const anchorPaths = (fm["paths"] as string[] | undefined) ?? [];
  const tags = Array.isArray(fm["tags"])
    ? (fm["tags"] as string[])
    : typeof fm["tags"] === "string"
    ? (fm["tags"] as string).split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    id: String(fm["id"]),
    title,
    type: String(fm["type"] ?? "unknown"),
    scope: String(fm["scope"] ?? "team"),
    status: String(fm["status"] ?? "draft"),
    tags,
    anchorPaths,
    anchored: anchorPaths.length > 0,
    isSeed: tags.includes("stack-pack"),
    requiresHumanApproval: fm["requires_human_approval"] === true,
    validatedBy: parseValidatedBy(fm["validated_by"]),
    body,
    filePath,
    createdAt: String(fm["created_at"] ?? ""),
    readCount: Number(fm["read_count"] ?? 0),
    module: fm["module"] ? String(fm["module"]) : undefined,
    domain: fm["domain"] ? String(fm["domain"]) : undefined,
  };
}

function parseValidatedBy(raw: unknown): "human" | "agent" | "auto" | null {
  return raw === "human" || raw === "agent" || raw === "auto" ? raw : null;
}

// ── Directory walker ────────────────────────────────────────────────────────

function walkDir(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, results);
    else if (entry.isFile() && entry.name.endsWith(".md")) results.push(full);
  }
  return results;
}

// ── MemoryStore — cached reader ─────────────────────────────────────────────

export class MemoryStore {
  private memories: Memory[] = [];
  private lastLoaded = 0;
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(
    public readonly workspaceRoot: string,
    private readonly onChanged: () => void,
  ) {}

  get memoriesDir(): string {
    const cfg = vscode.workspace.getConfiguration("haive");
    const rel = cfg.get<string>("memoriesDir") ?? ".ai/memories";
    return path.join(this.workspaceRoot, rel);
  }

  isInitialized(): boolean {
    return fs.existsSync(this.memoriesDir);
  }

  load(): Memory[] {
    const files = walkDir(this.memoriesDir);
    this.memories = files
      .map(parseMemoryFile)
      .filter((m): m is Memory => m !== null)
      .filter((m) => m.type !== "session_recap");
    this.lastLoaded = Date.now();
    return this.memories;
  }

  getAll(): Memory[] {
    return this.memories;
  }

  /** Memories whose anchor paths include the given workspace-relative path. */
  forFile(relPath: string): Memory[] {
    const normalized = relPath.replace(/\\/g, "/");
    return this.memories.filter((m) =>
      m.anchorPaths.some((p) => {
        const ap = p.replace(/\\/g, "/");
        return ap === normalized || normalized.endsWith(ap) || ap.endsWith(normalized);
      }),
    );
  }

  /** Count of action_required memories. */
  actionRequiredCount(): number {
    return this.memories.filter((m) => m.requiresHumanApproval && m.status !== "rejected").length;
  }

  /**
   * Stack-pack seeds that are not yet anchored to a file. These are the generic
   * starter memories a developer should curate — anchor to a real file or replace
   * with a repo-specific note — to raise them above background priority.
   */
  seedsNeedingCuration(): Memory[] {
    return this.memories.filter(
      (m) => m.isSeed && !m.anchored && m.status !== "rejected" && m.status !== "deprecated",
    );
  }

  /** Count of draft/proposed memories awaiting review. */
  pendingCount(): number {
    return this.memories.filter(
      (m) => (m.status === "draft" || m.status === "proposed") && !m.requiresHumanApproval,
    ).length;
  }

  startWatcher(): void {
    const pattern = new vscode.RelativePattern(
      this.workspaceRoot,
      ".ai/memories/**/*.md",
    );
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    const reload = () => { this.load(); this.onChanged(); };
    this.watcher.onDidChange(reload);
    this.watcher.onDidCreate(reload);
    this.watcher.onDidDelete(reload);
  }

  dispose(): void {
    this.watcher?.dispose();
  }
}
