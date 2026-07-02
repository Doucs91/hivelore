#!/usr/bin/env bash
# publish.sh — publish all Hivelore packages to npm safely.
#
# Usage:
#   ./scripts/publish.sh           # publish current version
#   ./scripts/publish.sh 0.5.0     # bump to new version then publish
#
# What it does (in order):
#   1. Optionally bump all package versions
#   2. Sync cross-package dependency versions (core, mcp, embeddings → same as main version)
#   3. Build all packages
#   4. Publish in dependency order: core → embeddings → mcp → cli
#   5. Create and push git tag

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# ── Determine version ──────────────────────────────────────────────────────
CURRENT=$(node -p "require('./packages/core/package.json').version")
TARGET="${1:-$CURRENT}"

echo "📦 Hivelore publish — v$TARGET"
echo ""

# ── Bump versions if different ─────────────────────────────────────────────
if [ "$TARGET" != "$CURRENT" ]; then
  echo "⬆  Bumping $CURRENT → $TARGET"
  for pkg in core cli mcp embeddings; do
    node -e "
      const fs = require('fs');
      const p = './packages/$pkg/package.json';
      const j = JSON.parse(fs.readFileSync(p, 'utf8'));
      j.version = '$TARGET';
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
    "
  done
fi

# ── Cross-package deps ─────────────────────────────────────────────────────
# Source package.json files keep `workspace:*` (see team attempt memory
# 2026-05-02-attempt-crosspackage-deps-with-xyz-ranges): pnpm rewrites the
# workspace protocol to the real version automatically at publish/pack time,
# so no source rewrite is needed — and rewriting would break local dev linking.
echo "🔗 Cross-package deps stay workspace:* (pnpm resolves them at publish time):"
grep '"@hivelore' packages/cli/package.json | grep -v '"name"'
grep '"@hivelore' packages/mcp/package.json | grep -v '"name"'

# ── Build ──────────────────────────────────────────────────────────────────
echo ""
echo "🔨 Building all packages..."
pnpm --filter @hivelore/core build
pnpm --filter @hivelore/embeddings build
pnpm --filter @hivelore/mcp build
pnpm --filter @hivelore/cli build
echo "   Build complete."

# ── Publish ────────────────────────────────────────────────────────────────
echo ""
echo "🚀 Publishing to npm..."
for pkg in core embeddings mcp cli; do
  echo "   Publishing @hivelore/$pkg@$TARGET..."
  pnpm --filter "@hivelore/$pkg" publish --access public --no-git-checks 2>&1 | \
    grep -v "^npm warn" | grep -v "^npm notice" || true
done

# ── Git tag ────────────────────────────────────────────────────────────────
echo ""
if [ "$TARGET" != "$CURRENT" ]; then
  git add packages/*/package.json
  git commit -m "chore: bump all packages to v$TARGET" || true
fi

if git tag "v$TARGET" 2>/dev/null; then
  echo "🏷  Tag v$TARGET created"
else
  echo "ℹ  Tag v$TARGET already exists (skipping)"
fi

git push origin "v$TARGET" 2>/dev/null || echo "ℹ  Tag already on remote"

echo ""
echo "✅ Published @hivelore/* v$TARGET"
echo "   Install with: npm install -g @hivelore/cli@$TARGET"

# ── Also build github-action ───────────────────────────────────────────────
if [ -d "packages/github-action" ]; then
  echo ""
  echo "🔨 Building github-action..."
  pnpm --filter "@hivelore/github-action" build 2>/dev/null || \
    (cd packages/github-action && node_modules/.bin/tsup src/run.ts --format cjs --out-dir dist --no-splitting)
fi
