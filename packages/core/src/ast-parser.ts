/**
 * Real-AST export extraction for the code-map — replaces the brittle per-language regex parsers.
 *
 * Uses web-tree-sitter (WASM, offline — consistent with the Transformers.js embeddings runtime) with
 * grammars vendored under ../grammars. A single Parser is initialized lazily; each language grammar is
 * loaded and cached on first use. If the runtime or a grammar cannot be initialized, `parseFileAst`
 * returns null so `buildCodeMap` falls back to the legacy regex parser — indexing never hard-fails.
 *
 * This module returns STRUCTURE only ({ name, kind, line }). Descriptions (JSDoc/docstring) and the
 * file summary are attached by code-map.ts, which owns that language-specific text extraction.
 */
import { fileURLToPath } from "node:url";
import Parser from "web-tree-sitter";
import type { CodeExportKind } from "./code-map.js";

export interface AstExport {
  name: string;
  kind: CodeExportKind;
  /** 1-based line of the declaration (or the `export`/assignment that introduces it). */
  line: number;
}

/** Extension → vendored grammar name. Anything not listed (e.g. `.kt`) yields a regex fallback. */
const GRAMMAR_BY_EXT: Record<string, string> = {
  ".ts": "typescript",
  ".mts": "typescript",
  ".cts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".java": "java",
  ".rb": "ruby",
  ".cs": "c_sharp",
  ".php": "php",
};

let initPromise: Promise<boolean> | null = null;
let parser: Parser | null = null;
const languages = new Map<string, Parser.Language | null>();

async function ensureInit(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        await Parser.init();
        parser = new Parser();
        return true;
      } catch {
        return false; // WASM runtime unavailable → caller falls back to regex
      }
    })();
  }
  return initPromise;
}

async function getLanguage(name: string): Promise<Parser.Language | null> {
  if (languages.has(name)) return languages.get(name) ?? null;
  try {
    const file = fileURLToPath(new URL(`../grammars/tree-sitter-${name}.wasm`, import.meta.url));
    const lang = await Parser.Language.load(file);
    languages.set(name, lang);
    return lang;
  } catch {
    languages.set(name, null); // grammar missing/incompatible → regex fallback for this language
    return null;
  }
}

/**
 * Parse a source file into its exported symbols using a real AST. Returns null when AST parsing is
 * unavailable for this file (unsupported extension, runtime init failure, or grammar load failure),
 * which signals the caller to use the regex fallback. An empty array means "parsed fine, no exports".
 */
export async function parseFileAst(source: string, ext: string): Promise<AstExport[] | null> {
  const grammar = GRAMMAR_BY_EXT[ext];
  if (!grammar) return null;
  if (!(await ensureInit()) || !parser) return null;
  const lang = await getLanguage(grammar);
  if (!lang) return null;

  let root: Parser.SyntaxNode;
  try {
    parser.setLanguage(lang);
    root = parser.parse(source).rootNode;
  } catch {
    return null;
  }

  const exports: AstExport[] = [];
  switch (grammar) {
    case "typescript":
    case "tsx":
    case "javascript":
      collectJs(root, exports);
      break;
    case "python":
      collectPython(root, exports);
      break;
    case "go":
      collectGo(root, exports);
      break;
    case "rust":
      collectRust(root, exports);
      break;
    case "java":
      collectJava(root, exports);
      break;
    case "ruby":
      collectRuby(root, exports);
      break;
    case "c_sharp":
      collectCSharp(root, exports);
      break;
    case "php":
      collectPhp(root, exports);
      break;
  }

  // Dedupe by name, keeping the first (document-order) occurrence — mirrors the regex parser.
  const seen = new Set<string>();
  return exports.filter((e) => (seen.has(e.name) ? false : (seen.add(e.name), true)));
}

function walk(node: Parser.SyntaxNode, fn: (n: Parser.SyntaxNode) => void): void {
  fn(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walk(child, fn);
  }
}

// ── JavaScript / TypeScript / TSX ────────────────────────────────────────────────────────────────

function collectJs(root: Parser.SyntaxNode, out: AstExport[]): void {
  walk(root, (node) => {
    if (node.type === "export_statement") handleExportStatement(node, out);
    else if (node.type === "assignment_expression") handleCjsAssignment(node, out);
  });
}

function handleExportStatement(node: Parser.SyntaxNode, out: AstExport[]): void {
  const line = node.startPosition.row + 1;

  const decl = node.childForFieldName("declaration");
  if (decl) {
    addJsDeclaration(decl, out, line);
    return;
  }

  // `export { a, b as c }` / `export { x } from "./mod"` — but NOT `export type { T }` (type-only).
  const clause = firstChildOfType(node, "export_clause");
  if (clause) {
    if (childIsKeyword(node, "type")) return; // `export type { ... }` — types, not runtime symbols
    for (let i = 0; i < clause.namedChildCount; i++) {
      const spec = clause.namedChild(i);
      if (!spec || spec.type !== "export_specifier") continue;
      if (childIsKeyword(spec, "type")) continue; // inline `export { type T }`
      const name = (spec.childForFieldName("alias") ?? spec.childForFieldName("name"))?.text;
      if (name && name !== "default") out.push({ name, kind: "const", line });
    }
    return;
  }

  // `export default <expr>` (anonymous) — a named default decl already went through addJsDeclaration.
  if (node.childForFieldName("value")) out.push({ name: "default", kind: "default", line });
}

function addJsDeclaration(decl: Parser.SyntaxNode, out: AstExport[], line: number): void {
  switch (decl.type) {
    case "function_declaration":
    case "generator_function_declaration":
      pushNamed(decl, "function", out, line);
      break;
    case "class_declaration":
    case "abstract_class_declaration":
      pushNamed(decl, "class", out, line);
      break;
    case "interface_declaration":
      pushNamed(decl, "interface", out, line);
      break;
    case "type_alias_declaration":
      pushNamed(decl, "type", out, line);
      break;
    case "enum_declaration":
      pushNamed(decl, "enum", out, line);
      break;
    case "lexical_declaration":
    case "variable_declaration":
      for (let i = 0; i < decl.namedChildCount; i++) {
        const d = decl.namedChild(i);
        if (!d || d.type !== "variable_declarator") continue;
        const nameNode = d.childForFieldName("name");
        if (nameNode?.type === "identifier" && nameNode.text) {
          out.push({ name: nameNode.text, kind: "const", line });
        }
      }
      break;
  }
}

function handleCjsAssignment(node: Parser.SyntaxNode, out: AstExport[]): void {
  const left = node.childForFieldName("left");
  const right = node.childForFieldName("right");
  if (!left) return;
  const line = node.startPosition.row + 1;
  const leftText = left.text;

  // `module.exports = …` / `exports = …`
  if (leftText === "module.exports" || leftText === "exports") {
    if (!right) return;
    if (right.type === "object") {
      for (let i = 0; i < right.namedChildCount; i++) {
        const prop = right.namedChild(i);
        if (!prop) continue;
        if (prop.type === "pair") {
          const key = prop.childForFieldName("key");
          if (key && (key.type === "property_identifier" || key.type === "identifier") && key.text) {
            out.push({ name: key.text, kind: "const", line });
          }
        } else if (
          prop.type === "shorthand_property_identifier" ||
          prop.type === "shorthand_property_identifier_pattern"
        ) {
          if (prop.text) out.push({ name: prop.text, kind: "const", line });
        }
        // spread_element (`...rest`) → nothing nameable
      }
    } else if (right.type === "identifier") {
      if (right.text) out.push({ name: right.text, kind: "const", line });
    } else if (right.type === "function" || right.type === "function_expression" || right.type === "generator_function") {
      pushNamed(right, "function", out, line);
    } else if (right.type === "class" || right.type === "class_expression") {
      pushNamed(right, "class", out, line);
    }
    return;
  }

  // `exports.foo = …` / `module.exports.foo = …`
  if (left.type === "member_expression") {
    const obj = left.childForFieldName("object")?.text;
    const prop = left.childForFieldName("property")?.text;
    if (prop && (obj === "exports" || obj === "module.exports")) {
      out.push({ name: prop, kind: "const", line });
    }
  }
}

// ── Python ───────────────────────────────────────────────────────────────────────────────────────

function collectPython(root: Parser.SyntaxNode, out: AstExport[]): void {
  walk(root, (node) => {
    if (node.type !== "function_definition" && node.type !== "class_definition") return;
    if (!isPythonTopLevel(node)) return;
    const name = node.childForFieldName("name")?.text;
    if (!name || name.startsWith("_")) return;
    out.push({ name, kind: node.type === "class_definition" ? "class" : "function", line: node.startPosition.row + 1 });
  });
}

/** Module-level (not nested inside another def/class). Decorated defs stay top-level. */
function isPythonTopLevel(node: Parser.SyntaxNode): boolean {
  let p = node.parent;
  while (p) {
    if (p.type === "function_definition" || p.type === "class_definition") return false;
    p = p.parent;
  }
  return true;
}

// ── Go ───────────────────────────────────────────────────────────────────────────────────────────

function collectGo(root: Parser.SyntaxNode, out: AstExport[]): void {
  walk(root, (node) => {
    if (node.type !== "function_declaration" && node.type !== "method_declaration") return;
    const name = node.childForFieldName("name")?.text;
    if (!name || !/^[A-Z]/.test(name)) return; // only exported (uppercase) symbols in Go
    out.push({ name, kind: "function", line: node.startPosition.row + 1 });
  });
}

// ── Rust ─────────────────────────────────────────────────────────────────────────────────────────

const RUST_KIND: Record<string, CodeExportKind> = {
  function_item: "function",
  struct_item: "class",
  impl_item: "class",
  enum_item: "enum",
  trait_item: "interface",
  type_item: "type",
  const_item: "const",
  mod_item: "const",
};

function collectRust(root: Parser.SyntaxNode, out: AstExport[]): void {
  walk(root, (node) => {
    const kind = RUST_KIND[node.type];
    if (!kind || !isRustPublic(node)) return;
    // impl blocks have no `name` field; the implemented type is the `type` field.
    const name = (node.childForFieldName("name") ?? node.childForFieldName("type"))?.text;
    if (name) out.push({ name, kind, line: node.startPosition.row + 1 });
  });
}

function isRustPublic(node: Parser.SyntaxNode): boolean {
  for (let i = 0; i < node.childCount; i++) {
    if (node.child(i)?.type === "visibility_modifier") return true;
  }
  return false;
}

// ── Java ─────────────────────────────────────────────────────────────────────────────────────────

const JAVA_KIND: Record<string, CodeExportKind> = {
  class_declaration: "class",
  record_declaration: "class",
  interface_declaration: "interface",
  annotation_type_declaration: "interface",
  enum_declaration: "enum",
};

function collectJava(root: Parser.SyntaxNode, out: AstExport[]): void {
  walk(root, (node) => {
    const kind = JAVA_KIND[node.type];
    if (!kind) return;
    const name = node.childForFieldName("name")?.text;
    if (name) out.push({ name, kind, line: node.startPosition.row + 1 });
  });
}

// ── Ruby ─────────────────────────────────────────────────────────────────────────────────────────

function collectRuby(root: Parser.SyntaxNode, out: AstExport[]): void {
  walk(root, (node) => {
    if (node.type === "class" || node.type === "module") {
      pushNamed(node, "class", out, node.startPosition.row + 1); // types/namespaces — kept even when nested
    } else if (node.type === "method" || node.type === "singleton_method") {
      // Top-level defs only (a method inside a class/module is an instance method, not a public symbol).
      if (isTopLevelMember(node, RUBY_CONTAINERS)) pushNamed(node, "function", out, node.startPosition.row + 1);
    }
  });
}
const RUBY_CONTAINERS = new Set(["class", "module", "method", "singleton_method"]);

// ── C# ───────────────────────────────────────────────────────────────────────────────────────────

const CSHARP_KIND: Record<string, CodeExportKind> = {
  class_declaration: "class",
  struct_declaration: "class",
  record_declaration: "class",
  interface_declaration: "interface",
  enum_declaration: "enum",
};

function collectCSharp(root: Parser.SyntaxNode, out: AstExport[]): void {
  walk(root, (node) => {
    const kind = CSHARP_KIND[node.type];
    if (kind) pushNamed(node, kind, out, node.startPosition.row + 1); // types live under namespaces — keep all
  });
}

// ── PHP ──────────────────────────────────────────────────────────────────────────────────────────

const PHP_TYPE_KIND: Record<string, CodeExportKind> = {
  class_declaration: "class",
  interface_declaration: "interface",
  trait_declaration: "interface",
  enum_declaration: "enum",
};

function collectPhp(root: Parser.SyntaxNode, out: AstExport[]): void {
  walk(root, (node) => {
    const kind = PHP_TYPE_KIND[node.type];
    if (kind) {
      pushNamed(node, kind, out, node.startPosition.row + 1);
      return;
    }
    if (node.type === "function_definition" && isTopLevelMember(node, PHP_CONTAINERS)) {
      pushNamed(node, "function", out, node.startPosition.row + 1); // top-level functions, not class methods
    }
  });
}
const PHP_CONTAINERS = new Set([
  "class_declaration",
  "interface_declaration",
  "trait_declaration",
  "enum_declaration",
]);

// ── shared helpers ───────────────────────────────────────────────────────────────────────────────

/** True when no ancestor of `node` is one of the given container types (i.e. it is not a nested member). */
function isTopLevelMember(node: Parser.SyntaxNode, containers: Set<string>): boolean {
  let p = node.parent;
  while (p) {
    if (containers.has(p.type)) return false;
    p = p.parent;
  }
  return true;
}

function pushNamed(node: Parser.SyntaxNode, kind: CodeExportKind, out: AstExport[], line: number): void {
  const name = node.childForFieldName("name")?.text;
  if (name) out.push({ name, kind, line });
}

function firstChildOfType(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | null {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c?.type === type) return c;
  }
  return null;
}

/** True when an unnamed `type` keyword appears directly under `node` (e.g. `export type { … }`). */
function childIsKeyword(node: Parser.SyntaxNode, keyword: string): boolean {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c && !c.isNamed && c.text === keyword) return true;
  }
  return false;
}
