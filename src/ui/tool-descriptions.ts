export interface ToolDescription {
  label: string;
  description: string;
  color: string;
}

export function describeToolCall(name: string, argsStr: string): ToolDescription {
  let args: Record<string, any> = {};
  try { args = JSON.parse(argsStr); } catch {}

  const friendly: Record<string, string> = {
    read_file: "Read", glob_files: "Glob", search_contents: "Search", workspace_map: "Map", write_file: "Write", edit_file: "Edit",
    execute_command: "Run", web_search: "Search", web_fetch: "Fetch",
    save_memory: "Remember", schedule: "Schedule",
    read_plan: "Plan", write_plan: "Plan", add_plan: "Plan", remove_plan: "Plan", prioritize_plan: "Plan", update_plan: "Plan",
    run_task_agent: "Task Agent", spawn_subagent: "Subagent",
    escalate: "Escalate", deescalate: "De-escalate",
  };

  // MCP tools: mcp_server_toolname → MCP:server:toolname
  if (name.startsWith("mcp_")) {
    const parts = name.match(/^mcp_([^_]+)_(.+)$/);
    const serverName = parts?.[1] ?? "";
    const toolName = parts?.[2] ?? name;
    const desc = Object.values(args).filter(v => typeof v === "string").join(", ").slice(0, 60) || argsStr.slice(0, 60);
    return { label: `MCP:${serverName}:${toolName}`, description: desc, color: "magenta" };
  }

  const label = friendly[name] || name;

  switch (name) {
    case "read_file": {
      const path = args.path || "file";
      const range = args.offset !== undefined ? `:${args.offset + 1}-${(args.offset || 0) + (args.limit || "end")}` : "";
      return { label, description: `${path}${range}`, color: "green" };
    }
    case "glob_files":
      return { label, description: args.pattern || "pattern", color: "green" };
    case "search_contents":
      return { label, description: `${args.pattern || "pattern"}${args.include ? ` in ${args.include}` : ""}`, color: "green" };
    case "write_file":
      return { label, description: args.path || "file", color: "blue" };
    case "edit_file":
      return { label, description: args.path || "file", color: "blue" };
    case "execute_command":
      return { label, description: args.command?.slice(0, 60) || "command", color: "yellow" };
    case "web_search":
      return { label, description: args.query?.slice(0, 60) || "query", color: "cyan" };
    case "web_fetch":
      return { label, description: args.url?.slice(0, 60) || "url", color: "cyan" };
    case "read_plan":
      return { label, description: args.name ? `load ${args.name}` : "list items", color: "#61afef" };
    case "add_plan":
      return { label, description: `add ${args.name || ""}`.trim(), color: "#61afef" };
    case "remove_plan":
      return { label, description: `remove ${args.name || ""}`.trim(), color: "#61afef" };
    case "prioritize_plan":
      return { label, description: `${args.name || ""} → ${args.priority || "?"}`.trim(), color: "#61afef" };
    case "update_plan":
      return { label, description: `edit ${args.name || "item"}`, color: "#61afef" };
    case "save_memory":
      return { label, description: args.title?.slice(0, 40) || "memory", color: "#d19a66" };
    case "escalate":
      return { label, description: args.reason?.slice(0, 60) || "requesting dense model", color: "red" };
    case "deescalate":
      return { label, description: "returning to utility", color: "green" };
    default:
      return { label, description: argsStr.slice(0, 60), color: "gray" };
  }
}
