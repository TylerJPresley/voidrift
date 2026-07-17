/**
 * Headless serve mode — JSON-RPC 2.0 over stdio.
 * Invoked via: voidrift --serve [--workspace <path>]
 */
import { createHeadlessHost } from "./bootstrap/headless.js";
import { CoreAPI } from "./plugins/interface.js";
import { PROTOCOL_VERSION, Methods, Notifications } from "./operator/protocol.js";

export async function runServe() {
  const args = process.argv.slice(2);
  let workspaceRoot: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--workspace" && args[i + 1]) {
      workspaceRoot = args[i + 1];
      i++;
    }
  }

function sendNotification(method: string, params: any) {
  const msg = JSON.stringify({ jsonrpc: "2.0", method, params });
  process.stdout.write(msg + "\n");
}

function sendResult(id: string | number, result: any) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, result });
  process.stdout.write(msg + "\n");
}

function sendError(id: string | number, code: number, message: string) {
  const msg = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
  process.stdout.write(msg + "\n");
}

async function main() {
  const host = await createHeadlessHost({ workspaceRoot });
  const op = host.core;

  // Forward bus events as notifications
  host.core.events.subscribe("TOKEN_STREAM", (e) => {
    if (e.payload.done) {
      const usage = (e.payload as any).usage;
      sendNotification(Notifications.STREAM_END, {
        model: "",
        inputTokens: usage?.promptTokens || 0,
        outputTokens: usage?.completionTokens || 0,
        elapsed: 0,
      });
    } else {
      sendNotification(Notifications.TOKEN_STREAM, e.payload);
    }
  });
  // Track tool start times for duration calculation
  const toolStartTimes = new Map<string, number>();

  host.core.events.subscribe("BEFORE_TOOL_EXECUTE", (e) => {
    const key = e.payload.toolName + JSON.stringify(e.payload.arguments);
    toolStartTimes.set(key, Date.now());
    sendNotification(Notifications.TOOL_CALL_START, {
      id: key, name: e.payload.toolName, args: JSON.stringify(e.payload.arguments),
    });
  });
  host.core.events.subscribe("TOOL_CONFIRMATION_REQUEST", (e) => {
    sendNotification(Notifications.TOOL_CONFIRMATION_REQUEST, {
      requestId: e.payload.requestId,
      tool: e.payload.tool,
      args: e.payload.args,
      diff: e.payload.diff,
      patterns: e.payload.inferredPatterns,
    });
  });
  host.core.events.subscribe("TURN_COMPLETE", (e) => {
    sendNotification(Notifications.TURN_COMPLETE, e.payload);
  });
  host.core.events.subscribe("ERROR_OCCURRED", (e) => {
    if (e.payload.source === "output") {
      sendNotification(Notifications.OUTPUT, { text: e.payload.message });
    } else if (e.payload.source === "panel") {
      sendNotification(Notifications.PANEL_OPEN, { name: e.payload.message.replace("panel:", "") });
    } else {
      sendNotification(Notifications.ERROR, e.payload);
    }
  });
  host.core.events.subscribe("MODE_CHANGED", (e) => {
    sendNotification(Notifications.MODE_CHANGED, { previous: e.payload.previousMode, current: e.payload.newMode });
  });
  host.core.events.subscribe("AFTER_TOOL_EXECUTE", (e) => {
    const key = e.payload.toolName + JSON.stringify(e.payload.arguments);
    const startTime = toolStartTimes.get(key) || Date.now();
    toolStartTimes.delete(key);
    const elapsed = (Date.now() - startTime) / 1000;
    sendNotification(Notifications.TOOL_CALL_END, {
      id: key, name: e.payload.toolName, status: e.payload.status, output: e.payload.output, elapsed,
      args: JSON.stringify(e.payload.arguments),
    });
  });
  host.core.events.subscribe("WORKSPACE_CHANGED", (e) => {
    sendNotification(Notifications.WORKSPACE_CHANGED, { paths: e.payload.filePaths, type: e.payload.changeType });
  });

  // Send handshake
  sendNotification("initialized", { protocolVersion: PROTOCOL_VERSION, sessionId: host.core.session.id });

  // Read JSON-RPC requests from stdin
  let buffer = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      handleRequest(line, op);
    }
  });

  process.stdin.on("end", () => {
    host.shutdown();
    process.exit(0);
  });
}

async function handleRequest(line: string, op: CoreAPI) {
  let req: any;
  try {
    req = JSON.parse(line);
  } catch {
    sendError(0, -32700, "Parse error");
    return;
  }

  const { id, method, params } = req;

  try {
    let result: any;

    switch (method) {
      case Methods.SESSION_SEND_INPUT: result = await op.session.send(params); break;
      case Methods.SESSION_CANCEL: op.session.cancel(); result = null; break;
      case Methods.SESSION_CLEAR: op.session.clear(); result = null; break;
      case Methods.SESSION_COMPACT: result = op.session.compact(); break;
      case Methods.SESSION_CONFIRM_TOOL: op.session.confirm(params); result = null; break;
      case Methods.SESSION_EXECUTE_COMMAND: result = await op.session.command(params.name, params.args); break;
      case Methods.SESSION_LIST_COMMANDS: result = op.session.listCommands(); break;

      case Methods.MODEL_LIST: result = op.models.list(); break;
      case Methods.MODEL_SWITCH: op.models.switch(params); result = null; break;
      case Methods.MODEL_GET_STATS: result = op.models.stats(); break;
      case Methods.MODEL_GET_CONTEXT: result = op.models.context(); break;

      case Methods.AGENT_LIST: result = op.agents.list(); break;
      case Methods.AGENT_GET: result = op.agents.get(params.id); break;
      case Methods.AGENT_ACTIVATE: op.agents.activate(params.id); result = null; break;
      case Methods.AGENT_CYCLE: result = op.agents.cycle(); break;

      case Methods.PLAN_LIST: result = op.plan.list(); break;
      case Methods.PLAN_GET: result = op.plan.get(params.filename); break;
      case Methods.PLAN_ADD: result = op.plan.add(params); break;
      case Methods.PLAN_UPDATE_PRIORITY: op.plan.updatePriority(params); result = null; break;
      case Methods.PLAN_UPDATE_BODY: op.plan.updateBody(params); result = null; break;
      case Methods.PLAN_REMOVE: op.plan.remove(params.filename); result = null; break;

      case Methods.SKILL_LIST: result = op.skills.list(); break;
      case Methods.SKILL_TOGGLE: op.skills.list(); result = null; break;
      case Methods.SKILL_REINDEX: result = op.skills.reindex(); break;

      case Methods.TEMPLATE_LIST: result = op.templates.list(); break;
      case Methods.TEMPLATE_GET: result = op.templates.get(params.key); break;

      case Methods.PROMPT_LIST: result = op.prompts.list(); break;
      case Methods.PROMPT_GET: result = op.prompts.get(params.key); break;

      case Methods.MCP_LIST_SERVERS: result = op.mcp.list(); break;
      case Methods.MCP_CONNECT: await op.mcp.connect(params.name); result = null; break;
      case Methods.MCP_DISCONNECT: op.mcp.disconnect(params.name); result = null; break;

      case Methods.MEMORY_LIST: result = op.memory.list(); break;
      case Methods.MEMORY_LOAD: op.memory.load(params.id); result = null; break;
      case Methods.MEMORY_UNLOAD: op.memory.unload(params.id); result = null; break;

      default:
        sendError(id, -32601, `Method not found: ${method}`);
        return;
    }

    sendResult(id, result);
  } catch (err: any) {
    sendError(id, -32000, err.message || "Internal error");
  }
}

  await main();
}
