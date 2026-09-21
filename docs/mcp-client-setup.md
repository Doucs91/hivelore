# Connect an AI client to Hivelore

Installing `@hivelore/cli` installs the MCP server. The AI client must also register it,
start it, and expose its tools to the conversation. Bridge files such as `AGENTS.md`
provide instructions; they do not establish an MCP connection.

From the project directory, after upgrading Hivelore:

```sh
hivelore agent setup --yes
hivelore agent status
hivelore agent check
```

`--yes` authorizes changes to detected user-level MCP configurations. Use `--no-global`
to change only project files. Existing disabled servers stay disabled; review those in
client settings. Invalid files are reported and left intact. Other servers, settings,
and JSONC comments are preserved.

Restart the AI client after setup and ask it to call `get_briefing`. The final call is
what confirms access inside that session. `agent check` starts a separate instance,
performs MCP initialization and lists tools with a timeout; it cannot inspect the
conversation's tool registry. A restrictive execution sandbox can also prevent this
separate check even when the host client can start the server.

| Client | Configuration managed by Hivelore |
| --- | --- |
| Codex | Native `codex mcp` commands; user TOML is parsed by Codex itself |
| Claude Code | Project `.mcp.json` and detected user configuration |
| Cursor | Project `.cursor/mcp.json` and detected user configuration |
| VS Code / Copilot | Workspace `.vscode/mcp.json` and detected user configuration |
| Windsurf | Detected user MCP configuration |
| Gemini CLI | Detected user `.gemini/settings.json`; project settings when detected |
| Roo Code | Project `.roo/mcp.json` when `.roo` exists |

Codex setup requires the `codex` executable. It registers `hivelore mcp --stdio` and
migrates obsolete `haive` entries only after successfully registering the replacement.
It does not set a global `HAIVE_PROJECT_ROOT`: that would route every project to the
same repository. Codex project overrides and managed restrictions can still prevent
access; inspect the effective settings with `codex mcp list` and the session with `/mcp`.

Project-specific configurations contain local absolute paths. Keep generated local
MCP configuration out of shared commits. Gemini settings may also contain unrelated
project settings; review their existing tracking policy before committing changes.

## Other MCP clients

Register a local **stdio** server named `hivelore` using these values in the client's
MCP settings (the outer JSON/TOML structure depends on the client):

```json
{
  "command": "hivelore",
  "args": ["mcp", "--stdio", "--dir", "/absolute/path/to/project"]
}
```

Explicit `--dir`/`--root` takes precedence over `HIVELORE_PROJECT_ROOT`, then
`HAIVE_PROJECT_ROOT`, then project discovery from the working directory.
For a global entry serving multiple projects, omit the fixed root and launch the
server in the active project's working directory.

If an IDE cannot find `hivelore` although your terminal can, its PATH differs (common
with Node version managers). Set the command to the absolute Node executable and
prepend the absolute Hivelore CLI JavaScript entry to `args`, or configure the IDE's
PATH. Recheck those paths after changing Node installations. For remote/SSH clients,
install and configure Hivelore in the environment that actually launches the server.

An AI client without MCP support cannot receive native MCP tools. Use the CLI
(`hivelore briefing`, `hivelore memory`, `hivelore enforce`) or `hivelore run -- <agent>`.

Client references: [Codex](https://learn.chatgpt.com/docs/extend/mcp),
[Gemini CLI](https://geminicli.com/docs/tools/mcp-server/),
[Roo Code](https://roocodeinc.github.io/Roo-Code/features/mcp/using-mcp-in-roo/),
[VS Code](https://code.visualstudio.com/docs/agent-customization/mcp-servers).
