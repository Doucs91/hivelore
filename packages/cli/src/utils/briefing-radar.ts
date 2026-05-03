import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export interface RadarOptions {
  root: string;
  taskTokens: string[] | null;
  filePaths: string[];
  daysBack?: number;
  maxCommits?: number;
  maxTodos?: number;
  maxHotFiles?: number;
}

export interface RadarReport {
  recentCommits: { sha: string; date: string; subject: string; files: string[] }[];
  openTodos: { file: string; line: number; text: string }[];
  hotFiles: { path: string; changes: number }[];
  insideGitRepo: boolean;
}

const DEFAULT_DAYS_BACK = 14;
const DEFAULT_MAX_COMMITS = 5;
const DEFAULT_MAX_TODOS = 8;
const DEFAULT_MAX_HOT_FILES = 5;

const TODO_RE = /\b(?:TODO|FIXME|HACK|XXX)\b[: ]?(.{0,120})/i;

const SOURCE_GLOBS = [
  "*.ts", "*.tsx", "*.js", "*.jsx", "*.py", "*.go", "*.rs",
  "*.java", "*.kt", "*.swift", "*.rb", "*.php", "*.cs", "*.cpp", "*.c", "*.h",
];

async function isGitRepo(root: string): Promise<boolean> {
  try {
    await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root });
    return true;
  } catch {
    return false;
  }
}

async function getRecentCommits(
  root: string,
  daysBack: number,
  maxCommits: number,
  taskTokens: string[] | null,
  filePaths: string[],
): Promise<RadarReport["recentCommits"]> {
  try {
    const { stdout } = await exec(
      "git",
      [
        "log",
        `--since=${daysBack}.days.ago`,
        "--name-only",
        "--pretty=format:%x1f%h%x1f%ad%x1f%s",
        "--date=short",
        "-n", "60",
      ],
      { cwd: root, maxBuffer: 4 * 1024 * 1024 },
    );

    const blocks = stdout.split("\x1f").filter((b) => b.trim().length > 0);
    const commits: RadarReport["recentCommits"] = [];
    for (let i = 0; i + 2 < blocks.length; i += 3) {
      const sha = blocks[i]!.trim();
      const date = blocks[i + 1]!.trim();
      const tail = blocks[i + 2]!;
      const lines = tail.split("\n").map((l) => l.trim()).filter(Boolean);
      const subject = lines.shift() ?? "";
      const files = lines;
      commits.push({ sha, date, subject, files });
    }

    const lowerTokens = taskTokens?.map((t) => t.toLowerCase()) ?? [];
    const lowerPaths = filePaths.map((p) => p.toLowerCase());
    const scored = commits.map((c) => {
      let score = 0;
      const haystack = (c.subject + " " + c.files.join(" ")).toLowerCase();
      for (const t of lowerTokens) if (haystack.includes(t)) score += 2;
      for (const p of lowerPaths) if (c.files.some((f) => f.toLowerCase().includes(p))) score += 3;
      return { c, score };
    });

    if (lowerTokens.length === 0 && lowerPaths.length === 0) {
      return commits.slice(0, maxCommits);
    }
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxCommits)
      .map((s) => s.c);
  } catch {
    return [];
  }
}

async function getOpenTodos(
  root: string,
  maxTodos: number,
  taskTokens: string[] | null,
  filePaths: string[],
): Promise<RadarReport["openTodos"]> {
  try {
    const includeArgs = SOURCE_GLOBS.flatMap((g) => ["--include", g]);
    const { stdout } = await exec(
      "grep",
      [
        "-rnE",
        "--exclude-dir=node_modules",
        "--exclude-dir=.git",
        "--exclude-dir=dist",
        "--exclude-dir=build",
        "--exclude-dir=.next",
        "--exclude-dir=coverage",
        ...includeArgs,
        "\\b(TODO|FIXME|HACK|XXX)\\b",
        ".",
      ],
      { cwd: root, maxBuffer: 4 * 1024 * 1024 },
    ).catch((err: { stdout?: string }) => ({ stdout: err.stdout ?? "" }));

    const lines = stdout.split("\n").filter(Boolean);
    const parsed: RadarReport["openTodos"] = [];
    for (const line of lines) {
      const m = line.match(/^([^:]+):(\d+):(.*)$/);
      if (!m) continue;
      const [, file, lineNoStr, rest] = m;
      const todoMatch = rest!.match(TODO_RE);
      if (!todoMatch) continue;
      const text = (todoMatch[1] ?? "").trim() || rest!.trim().slice(0, 120);
      parsed.push({ file: file!.replace(/^\.\//, ""), line: Number(lineNoStr), text });
    }

    const lowerTokens = taskTokens?.map((t) => t.toLowerCase()) ?? [];
    const lowerPaths = filePaths.map((p) => p.toLowerCase());
    if (lowerTokens.length === 0 && lowerPaths.length === 0) {
      return parsed.slice(0, maxTodos);
    }
    const scored = parsed.map((t) => {
      let score = 0;
      const hay = (t.file + " " + t.text).toLowerCase();
      for (const tok of lowerTokens) if (hay.includes(tok)) score += 1;
      for (const p of lowerPaths) if (t.file.toLowerCase().includes(p)) score += 2;
      return { t, score };
    });
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxTodos)
      .map((s) => s.t);
  } catch {
    return [];
  }
}

async function getHotFiles(
  root: string,
  daysBack: number,
  maxHotFiles: number,
  filePaths: string[],
): Promise<RadarReport["hotFiles"]> {
  try {
    const { stdout } = await exec(
      "git",
      [
        "log",
        `--since=${daysBack * 6}.days.ago`,
        "--name-only",
        "--pretty=format:",
      ],
      { cwd: root, maxBuffer: 4 * 1024 * 1024 },
    );
    const counts = new Map<string, number>();
    for (const raw of stdout.split("\n")) {
      const f = raw.trim();
      if (!f) continue;
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
    let entries = [...counts.entries()].map(([path, changes]) => ({ path, changes }));

    const lowerPaths = filePaths.map((p) => p.toLowerCase());
    if (lowerPaths.length > 0) {
      entries = entries.filter((e) => lowerPaths.some((p) => e.path.toLowerCase().includes(p)));
    }

    return entries.sort((a, b) => b.changes - a.changes).slice(0, maxHotFiles);
  } catch {
    return [];
  }
}

export async function buildRadar(opts: RadarOptions): Promise<RadarReport> {
  const inside = await isGitRepo(opts.root);
  if (!inside) {
    return { recentCommits: [], openTodos: [], hotFiles: [], insideGitRepo: false };
  }
  const daysBack = opts.daysBack ?? DEFAULT_DAYS_BACK;
  const [recentCommits, openTodos, hotFiles] = await Promise.all([
    getRecentCommits(opts.root, daysBack, opts.maxCommits ?? DEFAULT_MAX_COMMITS, opts.taskTokens, opts.filePaths),
    getOpenTodos(opts.root, opts.maxTodos ?? DEFAULT_MAX_TODOS, opts.taskTokens, opts.filePaths),
    getHotFiles(opts.root, daysBack, opts.maxHotFiles ?? DEFAULT_MAX_HOT_FILES, opts.filePaths),
  ]);
  return { recentCommits, openTodos, hotFiles, insideGitRepo: true };
}

export function radarHasContent(r: RadarReport): boolean {
  return r.recentCommits.length > 0 || r.openTodos.length > 0 || r.hotFiles.length > 0;
}
