import type { MCPEngine } from "./engine.js";

/**
 * Routes mcp_* tool calls to the correct MCP server via JSON-RPC.
 *
 * Tool names follow the pattern: mcp_<serverName>_<toolName>
 * Parses the server and tool, routes to the MCPEngine, returns result.
 */
export async function routeMCPToolCall(
  toolName: string,
  args: Record<string, unknown>,
  engine: MCPEngine
): Promise<{ success: boolean; output: string }> {
  // Parse: mcp_<server>_<tool>
  const match = toolName.match(/^mcp_([^_]+)_(.+)$/);
  if (!match) {
    return { success: false, output: `Invalid MCP tool name format: ${toolName}` };
  }

  const [, serverName, mcpToolName] = match;
  const server = engine.all.find((s) => s.name === serverName);

  if (!server) {
    return { success: false, output: `MCP server "${serverName}" not found` };
  }

  if (server.status !== "connected" || !server.process) {
    return { success: false, output: `MCP server "${serverName}" is not connected (status: ${server.status})` };
  }

  // Send JSON-RPC tools/call request
  try {
    const result = await callMCPTool(server.process, mcpToolName, args);
    return { success: true, output: typeof result === "string" ? result : JSON.stringify(result) };
  } catch (err) {
    return { success: false, output: `MCP call failed: ${err instanceof Error ? err.message : err}` };
  }
}

async function callMCPTool(proc: any, toolName: string, args: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("MCP tool call timed out")), 30000);
    const id = Date.now();
    const request = JSON.stringify({ jsonrpc: "2.0", method: "tools/call", id, params: { name: toolName, arguments: args } }) + "\n";

    let buffer = "";
    const handler = (data: Buffer) => {
      buffer += data.toString();
      try {
        const response = JSON.parse(buffer);
        if (response.id === id) {
          clearTimeout(timeout);
          proc.stdout?.off("data", handler);
          if (response.error) reject(new Error(response.error.message));
          else resolve(response.result?.content?.[0]?.text ?? response.result ?? "");
        }
      } catch { /* partial JSON, keep buffering */ }
    };

    proc.stdout?.on("data", handler);
    proc.stdin?.write(request);
  });
}

/**
 * Checks if a tool name is an MCP-routed tool.
 */
export function isMCPTool(toolName: string): boolean {
  return toolName.startsWith("mcp_");
}
