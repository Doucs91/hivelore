#!/usr/bin/env bash
# publish.sh — publish all hAIve packages to npm safely.
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

echo "📦 hAIve publish — v$TARGET"
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

# ── Sync cross-package deps (always) ──────────────────────────────────────
echo "🔗 Syncing cross-package dependency versions to ^$TARGET"
for pkg in cli mcp; do
  node -e "
    const fs = require('fs');
    const p = './packages/$pkg/package.json';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    const names = ['@hiveai/core','@hiveai/mcp','@hiveai/embeddings'];
    // Update in all dependency sections (dependencies, optionalDependencies, peerDependencies)
    for (const section of ['dependencies','optionalDependencies','peerDependencies']) {
      const deps = j[section] || {};
      names.forEach(name => { if (deps[name]) deps[name] = '^$TARGET'; });
      if (Object.keys(deps).length) j[section] = deps;
    }
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "
done

echo "   Deps synced:"
grep '"@hiveai' packages/cli/package.json | grep -v '"name"'
grep '"@hiveai' packages/mcp/package.json | grep -v '"name"'

# ── Build ──────────────────────────────────────────────────────────────────
echo ""
echo "🔨 Building all packages..."
pnpm --filter @hiveai/core build
pnpm --filter @hiveai/embeddings build
pnpm --filter @hiveai/mcp build
pnpm --filter @hiveai/cli build
echo "   Build complete."

# ── Publish ────────────────────────────────────────────────────────────────
echo ""
echo "🚀 Publishing to npm..."
for pkg in core embeddings mcp cli; do
  echo "   Publishing @hiveai/$pkg@$TARGET..."
  pnpm --filter "@hiveai/$pkg" publish --access public --no-git-checks 2>&1 | \
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
echo "✅ Published @hiveai/* v$TARGET"
echo "   Install with: npm install -g @hiveai/cli@$TARGET"

# ── Also build github-action ───────────────────────────────────────────────
if [ -d "packages/github-action" ]; then
  echo ""
  echo "🔨 Building github-action..."
  pnpm --filter "@hiveai/github-action" build 2>/dev/null || \
    (cd packages/github-action && node_modules/.bin/tsup src/run.ts --format cjs --out-dir dist --no-splitting)
fi
