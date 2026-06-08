# Vendored tree-sitter grammars

These prebuilt WebAssembly grammars power the code-map AST parser (`src/ast-parser.ts`).
They are loaded by `web-tree-sitter` (pinned to an ABI-compatible version) and are vendored
here — rather than pulled as a transitive dependency — to keep the install lean (only the 9
languages hAIve indexes, ~14 MB, vs. ~50 MB for the full grammar set) and to lock the grammar
ABI to the `web-tree-sitter` version this package depends on.

Languages: typescript, tsx, javascript, python, go, rust, java, ruby, c_sharp, php
(`.ts/.mts/.cts` and `.tsx` share the typescript/tsx grammars).

Source: prebuilt `.wasm` binaries from the `tree-sitter-wasms` project
(https://github.com/Gregoor/tree-sitter-wasms), which repackages the upstream tree-sitter
grammars. Each grammar retains the license of its upstream project (predominantly MIT). No
grammar source was modified.

If `web-tree-sitter` cannot initialize (or a grammar fails to load) the code-map parser falls
back to the legacy regex extractors, so indexing never hard-fails on an unsupported runtime.
