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
verified_at: null
stale_reason: null
related_ids: []
last_read_at: null
revision_count: 0
requires_human_approval: false
---
# Architecture Code Map Ast Web Tree Sitter Vendored Grammars

The code-map now extracts exports from a **real AST** (web-tree-sitter, WASM/offline — consistent with the Transformers.js embeddings runtime), not regex. `parseFileAst(source, ext)` in `ast-parser.ts` returns structure-only `{name, kind, line}[]`; `code-map.ts#decorateAstEntry` attaches JSDoc/docstring descriptions + file summary to keep the `CodeExport`/`CodeFileEntry` contract byte-stable for symbol lookup + the embeddings indexer.

**Key decisions:**
- **web-tree-sitter pinned EXACT to 0.22.6** — the grammar `.wasm` ABI is coupled to the runtime version; a mismatch throws a dylink-metadata error. Do NOT bump web-tree-sitter without re-vendoring ABI-matched grammars (and vice-versa).
- **Grammars are VENDORED** in `packages/core/grammars/*.wasm` (~7 MB, 6 langs) and shipped via package.json `files`, rather than depending on `tree-sitter-wasms` (~50 MB, 36 langs). web-tree-sitter is a tsup `external`.
- **Resolved at runtime** via `new URL("../grammars/tree-sitter-<name>.wasm", import.meta.url)` — works from both `src/` (tests) and `dist/` (published), since both sit one level under `packages/core/`.
- **Regex parsers are RETAINED as a fallback**: if `Parser.init()` or a grammar load fails (or the ext has no vendored grammar, e.g. `.kt`), `parseFileEntry` falls back to the legacy regex `parseFile` — indexing never hard-fails. `buildCodeMap`/`parseFileEntry` are now async.

**How to apply:** to add a language, vendor its ABI-matched grammar `.wasm`, add it to `GRAMMAR_BY_EXT`, and write a `collect<Lang>` walker. AST coverage mirrors the old regex coverage per language (Java = types only, Go = exported funcs/methods, Rust = pub items, Python = module-level non-underscore) plus correct JS/TS handling the regex missed (CJS, mid-line exports, multi-declarator, alias re-exports, type-only skip). See [[2026-04-25-gotcha-tsup-externals-required]].
