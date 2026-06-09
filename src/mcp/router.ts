import type { MCPEngine } from "./engine.js";

/**
 * Routes mcp_* tool calls to the correct MCP server.
 *
 * Tool names follow the pattern: mcp_<serverName>_<toolName>
 */
export async function routeMCPToolCall(
  toolName: string,
  args: Record<string, unknown>,
  engine: MCPEngine
): Promise<{ success: boolean; output: string }> {
  const match = toolName.match(/^mcp_([^_]+)_(.+)$/);
  if (!match) {
    return { success: false, output: `Invalid MCP tool name format: ${toolName}` };
  }

  const [, serverName, mcpToolName] = match;
  const result = await engine.callTool(serverName, mcpToolName, args);
  const success = !result.startsWith("Error:");
  return { success, output: result };
}

/**
 * Checks if a tool name is an MCP-routed tool.
 */
export function isMCPTool(toolName: string): boolean {
  return toolName.startsWith("mcp_");
}
