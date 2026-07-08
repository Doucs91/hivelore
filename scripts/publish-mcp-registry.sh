#!/usr/bin/env bash
# Publish (or refresh) Hivelore's entry in the official MCP Registry.
#
# Everything automatable is done here; you only complete the GitHub device-flow login when prompted.
# Run AFTER `@hivelore/mcp` is published to npm at the current version (mcpName must be on npm).
#
#   bash scripts/publish-mcp-registry.sh
set -euo pipefail
cd "$(dirname "$0")/.."

MCP_VERSION="$(node -p "require('./packages/mcp/package.json').version")"
MCP_NAME="$(node -p "require('./packages/mcp/package.json').mcpName || ''")"
[ -n "$MCP_NAME" ] || { echo "✗ packages/mcp/package.json has no mcpName — add it first." >&2; exit 1; }
echo "→ @hivelore/mcp @ ${MCP_VERSION}  (mcpName: ${MCP_NAME})"

# 1. install mcp-publisher if absent
if ! command -v mcp-publisher >/dev/null 2>&1; then
  echo "→ installing mcp-publisher into ~/.local/bin"
  mkdir -p "$HOME/.local/bin"
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')"
  curl -L "https://github.com/modelcontextprotocol/registry/releases/latest/download/mcp-publisher_${os}_${arch}.tar.gz" \
    | tar -xz -C "$HOME/.local/bin" mcp-publisher
  chmod +x "$HOME/.local/bin/mcp-publisher"
  export PATH="$HOME/.local/bin:$PATH"
fi
command -v mcp-publisher >/dev/null 2>&1 || { echo "✗ mcp-publisher not on PATH (add ~/.local/bin)" >&2; exit 1; }

# 2. keep server.json in lockstep with the published npm version
node -e '
  const fs = require("fs");
  const v = require("./packages/mcp/package.json").version;
  const s = JSON.parse(fs.readFileSync("server.json", "utf8"));
  s.version = v;
  if (s.packages && s.packages[0]) s.packages[0].version = v;
  fs.writeFileSync("server.json", JSON.stringify(s, null, 2) + "\n");
  console.log("→ synced server.json to version " + v);
'

# 2b. the registry caps description at 100 chars — fail early with a clear message, not a 422
DESC_LEN="$(node -p "require('./server.json').description.length")"
if [ "$DESC_LEN" -gt 100 ]; then
  echo "✗ server.json description is ${DESC_LEN} chars; the registry limit is 100. Shorten it." >&2
  exit 1
fi

# 3. the registry validates the npm package, so that exact version must already be published
if ! npm view "@hivelore/mcp@${MCP_VERSION}" version >/dev/null 2>&1; then
  echo "✗ @hivelore/mcp@${MCP_VERSION} is NOT on npm yet." >&2
  echo "  Publish it first (pnpm run publish:all), then re-run this script." >&2
  exit 1
fi
echo "✓ @hivelore/mcp@${MCP_VERSION} is on npm"

# 4. authenticate (interactive device flow) + publish
echo "→ mcp-publisher login github  (follow the device-code prompt)"
mcp-publisher login github
echo "→ mcp-publisher publish"
mcp-publisher publish

echo ""
echo "✓ Done. Verify:"
echo "  curl \"https://registry.modelcontextprotocol.io/v0.1/servers?search=${MCP_NAME}\""
