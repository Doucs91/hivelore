/**
 * Dependency version tracker.
 *
 * During `haive sync`, parse the project's dependency manifest files
 * (package.json, pom.xml, go.mod, Cargo.toml, requirements.txt, etc.),
 * compare against a snapshot stored at `.ai/contracts/deps-<name>.lock`,
 * and return memories that should be marked stale because a dependency
 * they reference has changed version (major bump = breaking change risk).
 */
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export interface DependencySnapshot {
  file: string;
  format: string;
  captured_at: string;
  deps: Record<string, string>; // name → version
}

export interface DepChange {
  name: string;
  from: string;
  to: string;
  /** true if the major version number changed */
  isMajorBump: boolean;
}

export interface DepTrackResult {
  file: string;
  changes: DepChange[];
}

// ── Manifest parsers ───────────────────────────────────────────────────────

/** Parse package.json (npm/pnpm/yarn) — returns name→version map */
function parsePackageJson(content: string): Record<string, string> {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    return {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };
  } catch {
    return {};
  }
}

/** Parse go.mod — returns module→version map */
function parseGoMod(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const m = line.trim().match(/^(\S+)\s+(v[\d.]+)/);
    if (m?.[1] && m[2]) result[m[1]] = m[2];
  }
  return result;
}

/** Parse requirements.txt (Python) — returns package→version map */
function parseRequirementsTxt(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const clean = (line.split("#")[0] ?? "").trim();
    const m = clean.match(/^([A-Za-z0-9_.-]+)[=><~!]+(.+)$/);
    if (m?.[1] && m[2]) result[m[1].toLowerCase()] = m[2].trim();
  }
  return result;
}

/** Parse Cargo.toml (Rust) — returns crate→version map */
function parseCargotoml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  let inDeps = false;
  for (const line of content.split("\n")) {
    if (/^\[(dependencies|dev-dependencies|build-dependencies)\]/.test(line.trim())) {
      inDeps = true;
      continue;
    }
    if (line.startsWith("[") && !line.includes("dependencies")) {
      inDeps = false;
      continue;
    }
    if (!inDeps) continue;
    const simple = line.match(/^(\w[\w-]*)\s*=\s*"([^"]+)"/);
    if (simple?.[1] && simple[2]) { result[simple[1]] = simple[2]; continue; }
    const table = line.match(/^(\w[\w-]*)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
    if (table?.[1] && table[2]) result[table[1]] = table[2];
  }
  return result;
}

/** Parse pom.xml (Maven) — returns groupId:artifactId→version map */
function parsePomXml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const depRe = /<dependency>[\s\S]*?<groupId>([^<]+)<\/groupId>[\s\S]*?<artifactId>([^<]+)<\/artifactId>[\s\S]*?<version>([^<]+)<\/version>[\s\S]*?<\/dependency>/g;
  let m: RegExpExecArray | null;
  while ((m = depRe.exec(content)) !== null) {
    if (m[1] && m[2] && m[3]) {
      result[`${m[1].trim()}:${m[2].trim()}`] = m[3].trim();
    }
  }
  return result;
}

// ── Auto-detection of manifest files ──────────────────────────────────────

const KNOWN_MANIFESTS: Array<{ name: string; parser: (c: string) => Record<string, string> }> = [
  { name: "package.json", parser: parsePackageJson },
  { name: "go.mod", parser: parseGoMod },
  { name: "requirements.txt", parser: parseRequirementsTxt },
  { name: "Cargo.toml", parser: parseCargotoml },
  { name: "pom.xml", parser: parsePomXml },
];

function getParser(file: string): ((c: string) => Record<string, string>) | null {
  const base = path.basename(file);
  return KNOWN_MANIFESTS.find((m) => m.name === base)?.parser ?? null;
}

// ── Version comparison ─────────────────────────────────────────────────────

function extractMajor(version: string): number | null {
  const clean = version.replace(/^[^0-9]*/, ""); // strip ^, ~, >=, v, etc.
  const firstPart = clean.split(".")[0];
  if (!firstPart) return null;
  const n = parseInt(firstPart, 10);
  return isNaN(n) ? null : n;
}

function isMajorBump(from: string, to: string): boolean {
  const fromMajor = extractMajor(from);
  const toMajor = extractMajor(to);
  if (fromMajor === null || toMajor === null) return false;
  return toMajor > fromMajor;
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve which manifest files to track.
 * Uses config.dependencyFiles if set, otherwise auto-detects from KNOWN_MANIFESTS.
 */
export function resolveManifestFiles(
  projectRoot: string,
  configuredFiles?: string[],
): string[] {
  if (configuredFiles !== undefined) {
    // Explicitly configured (can be [] to disable)
    return configuredFiles.map((f) => path.resolve(projectRoot, f)).filter(existsSync);
  }
  return KNOWN_MANIFESTS
    .map(({ name }) => path.join(projectRoot, name))
    .filter(existsSync);
}

/**
 * Check all manifest files for version changes since last snapshot.
 * Returns one result per file that has changes.
 */
export async function trackDependencies(
  projectRoot: string,
  haiveDir: string,
  manifestFiles: string[],
): Promise<DepTrackResult[]> {
  const contractsDir = path.join(haiveDir, "contracts");
  await mkdir(contractsDir, { recursive: true });

  const results: DepTrackResult[] = [];

  for (const manifestPath of manifestFiles) {
    const parser = getParser(manifestPath);
    if (!parser) continue;

    const content = await readFile(manifestPath, "utf8");
    const currentDeps = parser(content);
    const lockName = `deps-${path.basename(manifestPath)}.lock`;
    const lockPath = path.join(contractsDir, lockName);

    if (!existsSync(lockPath)) {
      // First run — save snapshot, no changes to report
      const snapshot: DependencySnapshot = {
        file: path.relative(projectRoot, manifestPath),
        format: path.basename(manifestPath),
        captured_at: new Date().toISOString(),
        deps: currentDeps,
      };
      await writeFile(lockPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
      continue;
    }

    const snapshot = JSON.parse(await readFile(lockPath, "utf8")) as DependencySnapshot;
    const changes: DepChange[] = [];

    for (const [name, currentVer] of Object.entries(currentDeps)) {
      const prevVer = snapshot.deps[name];
      if (prevVer && prevVer !== currentVer) {
        changes.push({
          name,
          from: prevVer,
          to: currentVer,
          isMajorBump: isMajorBump(prevVer, currentVer),
        });
      }
    }

    if (changes.length > 0) {
      results.push({ file: path.relative(projectRoot, manifestPath), changes });
      // Update snapshot
      const updated: DependencySnapshot = {
        ...snapshot,
        captured_at: new Date().toISOString(),
        deps: currentDeps,
      };
      await writeFile(lockPath, JSON.stringify(updated, null, 2) + "\n", "utf8");
    }
  }

  return results;
}
