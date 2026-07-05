# Module: engram

Local nested checkout of Engram used only as a competitor/reference implementation during harness analysis. It has its own Git repository and release process.

## Purpose

- Compare memory architecture, agent integration, persistence, and retrieval semantics against Hivelore.
- Provide source-backed competitive observations without coupling Hivelore packages to Engram.

## Boundaries

- Treat `engram/` as read-only unless the developer explicitly requests work in that repository.
- Never add Engram as a Hivelore workspace dependency or include its generated/runtime data in Hivelore releases.
- Cross-repo API or contract changes require explicit developer approval.
- Run Engram tests and commits from its own repository; do not mix them into the outer Hivelore release commit.
