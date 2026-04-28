---
id: 2026-04-28-convention-version-bump-all-packages-together
scope: team
type: convention
status: validated
anchor:
  paths: []
  symbols: []
tags:
  - versioning
  - publish
  - npm
  - monorepo
created_at: '2026-04-28T04:18:10.031Z'
expires_when: null
verified_at: null
stale_reason: null
---
# Always bump all 4 packages to the same version

hAIve uses a single version across all packages (core, cli, mcp, embeddings). When releasing:

1. Bump all package.json versions simultaneously:
   ```bash
   for pkg in core cli mcp embeddings; do
     sed -i 's/"version": ".*"/"version": "X.Y.Z"/' packages/$pkg/package.json
   done
   ```
2. Build: `pnpm -r build`
3. Commit with message `feat: vX.Y.Z — summary`
4. Tag: `git tag vX.Y.Z`
5. Push: `git push && git push --tags`
6. Publish: run `npm publish --access public` in each package directory

**Why**: users install cli + mcp as a pair; version skew between them causes subtle breakage (schema mismatch, missing tools).
**Note**: cross-package deps use `workspace:*` inside the monorepo — npm resolves this to the actual version on publish.
