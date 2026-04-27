import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHaiveServer, SERVER_VERSION } from "./server.js";

function parseArgs(argv: string[]): { root?: string } {
  const out: { root?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" || arg === "-r") {
      out.root = argv[++i];
    } else if (arg?.startsWith("--root=")) {
      out.root = arg.slice("--root=".length);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const { root } = parseArgs(process.argv);
  const { server, context } = createHaiveServer({ root });
  // stderr is safe — stdio transport uses stdin/stdout exclusively for MCP frames.
  console.error(
    `[haive-mcp] starting server v${SERVER_VERSION} (project root: ${context.paths.root})`,
  );
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err: unknown) => {
  console.error("[haive-mcp] fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
