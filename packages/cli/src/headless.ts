import { loadConfig } from "./config/loader.js";
import { createAdapter } from "./adapters/factory.js";
import { SessionManager } from "./session/manager.js";
import { ToolRegistry } from "./tools/registry.js";
import { builtinTools } from "./tools/builtins.js";

export async function runHeadless(message: string): Promise<void> {
  const { model } = loadConfig();
  const adapter = createAdapter(model);
  const registry = new ToolRegistry();
  builtinTools.forEach(t => registry.register(t));

  // In headless mode, auto-deny all confirmations
  const session = new SessionManager(adapter, registry, async () => "deny");

  let output = "";
  for await (const event of session.send(message)) {
    switch (event.type) {
      case "content":
        process.stdout.write(event.content || "");
        output += event.content;
        break;
      case "tool_call":
        process.stderr.write(`[tool] ${event.toolCall!.name}(${event.toolCall!.args})\n`);
        break;
      case "tool_result":
        process.stderr.write(`[result] ${event.toolResult!.result.slice(0, 100)}\n`);
        break;
      case "tool_denied":
        process.stderr.write(`[denied] ${event.toolCall!.name}\n`);
        break;
      case "error":
        process.stderr.write(`[error] ${event.error}\n`);
        process.exit(1);
        break;
    }
  }
  if (output && !output.endsWith("\n")) process.stdout.write("\n");
}
