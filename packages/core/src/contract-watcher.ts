/**
 * Contract snapshot and diff watcher.
 *
 * Supports:
 *   - OpenAPI/Swagger (JSON or YAML)
 *   - GraphQL schema
 *   - Protocol Buffers (.proto)
 *   - TypeScript declaration files (.d.ts)
 *   - JSON Schema
 *
 * `haive snapshot --contract <file>` saves a snapshot to .ai/contracts/<name>.lock
 * `haive sync` compares current file against snapshot and returns BreakingChange[].
 */
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type { ContractFile } from "./config.js";

export interface ContractSnapshot {
  name: string;
  path: string;
  format: string;
  captured_at: string;
  hash: string;            // SHA-256 of file content
  endpoints?: string[];    // OpenAPI: list of "METHOD /path"
  types?: string[];        // GraphQL/TS: list of type/interface/message names
  fields?: Record<string, string[]>; // type → list of field names
  raw_lines?: string[];    // fallback: full file lines for line-by-line diff
}

export interface BreakingChange {
  kind:
    | "endpoint_removed"
    | "endpoint_added"
    | "type_removed"
    | "type_added"
    | "field_removed"
    | "field_added"
    | "content_changed";
  description: string;
  severity: "breaking" | "additive" | "unknown";
}

export interface ContractDiffResult {
  contract: string;
  file: string;
  changes: BreakingChange[];
  unchanged: boolean;
}

// ── Parsers ────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Parse OpenAPI/Swagger — extract endpoint list and schemas */
function parseOpenApi(content: string, file: string): Partial<ContractSnapshot> {
  try {
    let doc: Record<string, unknown>;
    if (file.endsWith(".yaml") || file.endsWith(".yml")) {
      // Simple YAML line-based extraction (no full YAML parser dep)
      doc = parseYamlPaths(content);
    } else {
      doc = JSON.parse(content) as Record<string, unknown>;
    }
    const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
    const endpoints: string[] = [];
    for (const [routePath, methods] of Object.entries(paths)) {
      for (const method of Object.keys(methods)) {
        if (["get","post","put","patch","delete","head","options"].includes(method)) {
          endpoints.push(`${method.toUpperCase()} ${routePath}`);
        }
      }
    }
    // Extract schema/component names
    const schemas = (
      (doc.components as Record<string, unknown> | undefined)?.schemas ??
      (doc.definitions as Record<string, unknown> | undefined) ??
      {}
    ) as Record<string, Record<string, unknown>>;
    const types = Object.keys(schemas);
    const fields: Record<string, string[]> = {};
    for (const [typeName, schema] of Object.entries(schemas)) {
      const props = (schema.properties ?? {}) as Record<string, unknown>;
      fields[typeName] = Object.keys(props);
    }
    return { endpoints, types, fields };
  } catch {
    return {};
  }
}

/** Naive YAML paths extractor — avoids needing js-yaml dep */
function parseYamlPaths(content: string): Record<string, unknown> {
  const result: Record<string, Record<string, boolean>> = {};
  let currentPath = "";
  for (const line of content.split("\n")) {
    const pathMatch = line.match(/^  (\/[^\s:]+):/);
    if (pathMatch?.[1]) {
      currentPath = pathMatch[1];
      result[currentPath] = {};
      continue;
    }
    if (currentPath) {
      const methodMatch = line.match(/^    (get|post|put|patch|delete|head|options):/);
      if (methodMatch?.[1]) (result[currentPath] ??= {})[methodMatch[1]] = true;
    }
  }
  return { paths: result };
}

/** Parse GraphQL schema — extract type/interface/union/enum names */
function parseGraphQL(content: string): Partial<ContractSnapshot> {
  const types: string[] = [];
  const fields: Record<string, string[]> = {};
  let currentType = "";

  for (const line of content.split("\n")) {
    const typeMatch = line.match(/^(?:type|interface|union|enum|input)\s+(\w+)/);
    if (typeMatch?.[1]) {
      currentType = typeMatch[1];
      types.push(currentType);
      fields[currentType] = [];
      continue;
    }
    if (currentType && line.trim().startsWith("}")) {
      currentType = "";
      continue;
    }
    if (currentType) {
      const fieldMatch = line.match(/^\s+(\w+)\s*[:(]/);
      if (fieldMatch?.[1]) (fields[currentType] ??= []).push(fieldMatch[1]);
    }
  }
  return { types, fields };
}

/** Parse .proto (Protocol Buffers) — extract message/service names */
function parseProto(content: string): Partial<ContractSnapshot> {
  const types: string[] = [];
  const fields: Record<string, string[]> = {};
  let currentMsg = "";

  for (const line of content.split("\n")) {
    const msgMatch = line.match(/^(?:message|service|enum)\s+(\w+)/);
    if (msgMatch?.[1]) {
      currentMsg = msgMatch[1];
      types.push(currentMsg);
      fields[currentMsg] = [];
      continue;
    }
    if (currentMsg && line.trim() === "}") {
      currentMsg = "";
      continue;
    }
    if (currentMsg) {
      const fieldMatch = line.match(/^\s+(?:optional|required|repeated)?\s*\w+\s+(\w+)\s*=/);
      if (fieldMatch?.[1]) (fields[currentMsg] ??= []).push(fieldMatch[1]);
      const rpcMatch = line.match(/^\s+rpc\s+(\w+)/);
      if (rpcMatch?.[1]) (fields[currentMsg] ??= []).push(`rpc:${rpcMatch[1]}`);
    }
  }
  return { types, fields };
}

/** Parse TypeScript .d.ts — extract exported interface/class/type names */
function parseTypescript(content: string): Partial<ContractSnapshot> {
  const types: string[] = [];
  const fields: Record<string, string[]> = {};
  let currentType = "";
  let braceDepth = 0;

  for (const line of content.split("\n")) {
    const exportMatch = line.match(/^export\s+(?:declare\s+)?(?:interface|class|type|enum)\s+(\w+)/);
    if (exportMatch?.[1]) {
      currentType = exportMatch[1];
      types.push(currentType);
      fields[currentType] = [];
    }
    if (currentType) {
      braceDepth += (line.match(/{/g) ?? []).length;
      braceDepth -= (line.match(/}/g) ?? []).length;
      if (braceDepth <= 0 && line.includes("}")) { currentType = ""; braceDepth = 0; continue; }
      const memberMatch = line.match(/^\s+(?:readonly\s+)?(\w+)\s*[?:(!]/);
      if (memberMatch?.[1] && currentType) (fields[currentType] ??= []).push(memberMatch[1]);
    }
  }
  return { types, fields };
}

function parseByFormat(
  content: string,
  format: ContractFile["format"],
  filePath: string,
): Partial<ContractSnapshot> {
  switch (format) {
    case "openapi": return parseOpenApi(content, filePath);
    case "graphql": return parseGraphQL(content);
    case "proto": return parseProto(content);
    case "typescript": return parseTypescript(content);
    case "json-schema": {
      try {
        const schema = JSON.parse(content) as Record<string, Record<string, unknown>>;
        const types = Object.keys((schema.definitions ?? schema.properties ?? {}) as Record<string, unknown>);
        return { types };
      } catch { return {}; }
    }
    default: return {};
  }
}

// ── Diff logic ─────────────────────────────────────────────────────────────

function diffLists(before: string[], after: string[], kind: string): BreakingChange[] {
  const changes: BreakingChange[] = [];
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  for (const item of beforeSet) {
    if (!afterSet.has(item)) {
      const isBreaking = kind === "endpoint" || kind === "field" || kind === "type";
      changes.push({
        kind: `${kind}_removed` as BreakingChange["kind"],
        description: `${kind} removed: ${item}`,
        severity: isBreaking ? "breaking" : "unknown",
      });
    }
  }
  for (const item of afterSet) {
    if (!beforeSet.has(item)) {
      changes.push({
        kind: `${kind}_added` as BreakingChange["kind"],
        description: `${kind} added: ${item}`,
        severity: "additive",
      });
    }
  }
  return changes;
}

function diffSnapshots(before: ContractSnapshot, after: ContractSnapshot): BreakingChange[] {
  if (before.hash === after.hash) return [];

  const changes: BreakingChange[] = [];

  // Endpoint diff (OpenAPI)
  if (before.endpoints && after.endpoints) {
    changes.push(...diffLists(before.endpoints, after.endpoints, "endpoint"));
  }

  // Type diff (all formats)
  if (before.types && after.types) {
    changes.push(...diffLists(before.types, after.types, "type"));
  }

  // Field diff per type
  if (before.fields && after.fields) {
    const allTypes = new Set([...Object.keys(before.fields), ...Object.keys(after.fields)]);
    for (const typeName of allTypes) {
      const beforeFields = before.fields[typeName] ?? [];
      const afterFields = after.fields[typeName] ?? [];
      const fieldChanges = diffLists(beforeFields, afterFields, "field");
      for (const fc of fieldChanges) {
        changes.push({ ...fc, description: `${typeName}.${fc.description}` });
      }
    }
  }

  // Fallback: file changed but no structured diff
  if (changes.length === 0) {
    changes.push({
      kind: "content_changed",
      description: "Contract file content changed (no structured diff available)",
      severity: "unknown",
    });
  }

  return changes;
}

// ── Public API ─────────────────────────────────────────────────────────────

export function contractLockPath(haiveDir: string, name: string): string {
  return path.join(haiveDir, "contracts", `${name}.lock`);
}

/**
 * Take a snapshot of a contract file and save it to .ai/contracts/<name>.lock.
 * Returns the snapshot.
 */
export async function snapshotContract(
  projectRoot: string,
  haiveDir: string,
  contract: ContractFile,
): Promise<ContractSnapshot> {
  const filePath = path.resolve(projectRoot, contract.path);
  if (!existsSync(filePath)) {
    throw new Error(`Contract file not found: ${filePath}`);
  }
  const content = await readFile(filePath, "utf8");
  const parsed = parseByFormat(content, contract.format, filePath);
  const snapshot: ContractSnapshot = {
    name: contract.name,
    path: contract.path,
    format: contract.format,
    captured_at: new Date().toISOString(),
    hash: sha256(content),
    ...parsed,
  };
  const contractsDir = path.join(haiveDir, "contracts");
  await mkdir(contractsDir, { recursive: true });
  await writeFile(contractLockPath(haiveDir, contract.name), JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  return snapshot;
}

/**
 * Compare a contract file against its stored snapshot.
 * Returns the diff result. If no snapshot exists, creates one and returns unchanged.
 */
export async function diffContract(
  projectRoot: string,
  haiveDir: string,
  contract: ContractFile,
): Promise<ContractDiffResult> {
  const filePath = path.resolve(projectRoot, contract.path);
  if (!existsSync(filePath)) {
    return { contract: contract.name, file: contract.path, changes: [], unchanged: true };
  }

  const lockPath = contractLockPath(haiveDir, contract.name);

  if (!existsSync(lockPath)) {
    // First time — save snapshot
    await snapshotContract(projectRoot, haiveDir, contract);
    return { contract: contract.name, file: contract.path, changes: [], unchanged: true };
  }

  const content = await readFile(filePath, "utf8");
  const beforeSnapshot = JSON.parse(await readFile(lockPath, "utf8")) as ContractSnapshot;
  const afterParsed = parseByFormat(content, contract.format, filePath);
  const afterSnapshot: ContractSnapshot = {
    ...beforeSnapshot,
    hash: sha256(content),
    captured_at: new Date().toISOString(),
    ...afterParsed,
  };

  const changes = diffSnapshots(beforeSnapshot, afterSnapshot);

  if (changes.length > 0) {
    // Update snapshot to current state
    await writeFile(lockPath, JSON.stringify(afterSnapshot, null, 2) + "\n", "utf8");
  }

  return {
    contract: contract.name,
    file: contract.path,
    changes,
    unchanged: changes.length === 0,
  };
}

/**
 * Check all configured contract files for changes.
 */
export async function watchContracts(
  projectRoot: string,
  haiveDir: string,
  contractFiles: ContractFile[],
): Promise<ContractDiffResult[]> {
  const results: ContractDiffResult[] = [];
  for (const contract of contractFiles) {
    results.push(await diffContract(projectRoot, haiveDir, contract));
  }
  return results.filter((r) => !r.unchanged);
}
