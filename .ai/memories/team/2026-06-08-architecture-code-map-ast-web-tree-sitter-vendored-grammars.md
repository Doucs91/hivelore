---
id: 2026-06-08-architecture-code-map-ast-web-tree-sitter-vendored-grammars
scope: team
type: architecture
status: validated
anchor:
  paths:
    - packages/core/src/ast-parser.ts
    - packages/core/src/code-map.ts
    - packages/core/grammars/NOTICE.md
  symbols: []
tags: []
created_at: '2026-06-08T13:50:49.800Z'
expires_when: null
verified_at: '2026-07-02T22:21:21.996Z'
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
validated_by: null
---
# Architecture Code Map Ast Web Tree Sitter Vendored Grammars

The code-map now extracts exports from a **real AST** (web-tree-sitter, WASM/offline — consistent with the Transformers.js embeddings runtime), not regex. `parseFileAst(source, ext)` in `ast-parser.ts` returns structure-only `{name, kind, line}[]`; `code-map.ts#decorateAstEntry` attaches JSDoc/docstring descriptions + file summary to keep the `CodeExport`/`CodeFileEntry` contract byte-stable for symbol lookup + the embeddings indexer.

**Key decisions:**
- **web-tree-sitter pinned EXACT to 0.22.6** — the grammar `.wasm` ABI is coupled to the runtime version; a mismatch throws a dylink-metadata error. Do NOT bump web-tree-sitter without re-vendoring ABI-matched grammars (and vice-versa).
- **Grammars are VENDORED** in `packages/core/grammars/*.wasm` (~14 MB, 9 langs: ts/tsx/js/py/go/rust/java/ruby/c_sharp/php; `.ts/.mts/.cts` share the typescript grammar) and shipped via package.json `files`, rather than depending on `tree-sitter-wasms` (~50 MB, 36 langs). web-tree-sitter is a tsup `external`.
- **Resolved at runtime** via `new URL("../grammars/tree-sitter-<name>.wasm", import.meta.url)` — works from both `src/` (tests) and `dist/` (published), since both sit one level under `packages/core/`.
- **Regex parsers are RETAINED as a fallback**: if `Parser.init()` or a grammar load fails (or the ext has no vendored grammar, e.g. `.kt`), `parseFileEntry` falls back to the legacy regex `parseFile` — indexing never hard-fails. `buildCodeMap`/`parseFileEntry` are now async.

**How to apply:** to add a language, vendor its ABI-matched grammar `.wasm`, add it to `GRAMMAR_BY_EXT`, and write a `collect<Lang>` walker. Per-language coverage: JS/TS = full (incl. the regex misses: CJS, mid-line exports, multi-declarator, alias re-exports, type-only skip); Python = module-level non-underscore def/class; Ruby = top-level defs + class/module; Go = exported funcs/methods **+ exported struct/interface/alias types**; Rust = `pub` items; Java/C#/PHP = type declarations **+ PUBLIC methods** (Java: `modifiers` contains `public`; C#: explicit `public` modifier since default is private; PHP: `public` or no `visibility_modifier`). Instance/private methods are excluded. See [[2026-04-25-gotcha-tsup-externals-required]].
