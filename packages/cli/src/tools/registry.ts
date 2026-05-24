export interface ToolParameter {
  type: string;
  description: string;
}

export type ConfirmPolicy = "auto" | "confirm";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  confirmPolicy: ConfirmPolicy;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export type ConfirmResult = "allow" | "always" | "deny";

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();
  private alwaysApproved = new Set<string>();

  register(tool: ToolDefinition) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  needsConfirmation(name: string): boolean {
    if (this.alwaysApproved.has(name)) return false;
    const tool = this.tools.get(name);
    return tool?.confirmPolicy === "confirm";
  }

  approveAlways(name: string) {
    this.alwaysApproved.add(name);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: unknown tool "${name}"`;
    try {
      return await tool.execute(args);
    } catch (err: any) {
      return `Error: ${err.message}`;
    }
  }

  toOpenAITools() {
    return Array.from(this.tools.values()).map(t => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: {
          type: "object",
          properties: Object.fromEntries(
            Object.entries(t.parameters).map(([k, v]) => [k, { type: v.type, description: v.description }])
          ),
          required: Object.keys(t.parameters),
        },
      },
    }));
  }
}
