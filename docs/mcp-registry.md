# Publishing Hivelore to the official MCP Registry

The [MCP Registry](https://registry.modelcontextprotocol.io) is the "app store" of MCP servers:
MCP clients (Claude Code, Cursor, VS Code, …) browse it to discover and install servers. It stores
only **metadata** — the code stays on npm (`@hivelore/mcp`). Our metadata card is [`server.json`](../server.json).

Everything that can be automated is done for you:

- `packages/mcp/package.json` carries `"mcpName": "io.github.Doucs91/hivelore"` (the ownership link).
- `server.json` (repo root) is the published manifest; its `name` matches `mcpName`.
- `scripts/publish-mcp-registry.sh` installs the publisher CLI, syncs `server.json`'s version to the
  published `@hivelore/mcp`, checks that version is on npm, then runs login + publish.

## One-time / per-release steps (human)

Publishing needs your GitHub identity (device-flow login) and npm publish rights, so it is **not**
run in CI. After a normal release (`@hivelore/mcp` published to npm at the bumped version):

```bash
# 1. Publish the npm package as usual (this is the step that ships mcpName to npm)
pnpm run publish:all

# 2. Publish/refresh the registry entry (installs mcp-publisher, syncs version, login, publish)
bash scripts/publish-mcp-registry.sh
```

`scripts/publish-mcp-registry.sh` will:

1. install `mcp-publisher` (into `~/.local/bin` if not already on PATH);
2. set `server.json`'s `version` and `packages[0].version` to the current `@hivelore/mcp` version;
3. verify that exact version exists on npm (the registry validates the package, not just the name);
4. run `mcp-publisher login github` — **this prompts you** for the device code at
   <https://github.com/login/device>;
5. run `mcp-publisher publish`.

## Verify

```bash
curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.Doucs91/hivelore"
```

## Notes

- The namespace **must** be `io.github.Doucs91/…` because we authenticate with GitHub. A custom prefix
  (e.g. `io.hivelore/…`) would require DNS authentication and a domain you own — see the registry
  [authentication docs](https://modelcontextprotocol.io/registry/authentication).
- `@hivelore/mcp` must be **republished with `mcpName`** for the registry check to pass — a version
  that predates the field (≤ 0.53.0) will fail validation. Always publish npm *before* the registry.
- The registry is in preview; re-run step 2 after each release to keep the listed version current.
