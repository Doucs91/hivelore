import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpCheckResult {
  server_reachable: boolean;
  session_connection: "unverified";
  server_version?: string;
  tools: string[];
  error?: string;
}

/** A bounded protocol check of our own server; never execute arbitrary client-config commands. */
export async function checkMcpServer(root: string, cliEntry: string, timeout = 10_000): Promise<McpCheckResult> {
  const client = new Client({ name: "hivelore-diagnostic", version: "1.0.0" });
  const result: McpCheckResult = { server_reachable: false, session_connection: "unverified", tools: [] };
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [cliEntry, "mcp", "--stdio", "--dir", root], stderr: "pipe", cwd: root });
  // Drain without printing logs or environment values into diagnostic output.
  transport.stderr?.on("data", () => {});
  try {
    await client.connect(transport, { timeout });
    const response = await client.listTools({}, { timeout });
    result.tools = response.tools.map((tool) => tool.name);
    result.server_version = client.getServerVersion()?.version;
    result.server_reachable = result.tools.includes("get_briefing") && result.tools.includes("mem_relevant_to");
    if (!result.server_reachable) result.error = "The server answered but required Hivelore tools are missing.";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    await client.close().catch(() => {});
  }
  return result;
}
