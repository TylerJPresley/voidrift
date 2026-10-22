#!/usr/bin/env node
/**
 * A tiny real stdio MCP server fixture for the §8.4 MCP-trust E2E.
 *
 * It exposes ONE tool, `lookup`, annotated `readOnlyHint: true`, and records
 * every call to a JSONL file the test reads back (the "ZERO calls" assertions
 * depend on this file never gaining a line unless the server was actually
 * invoked). It speaks the real MCP protocol over `StdioServerTransport`, so the
 * E2E exercises the production SDK `Client` → child process path for the first
 * time — not an in-process stub.
 *
 * Env knobs (so the test can mutate the surface across runs without editing a
 * committed file):
 *   MCP_FIXTURE_CALLLOG   — path the fixture appends one line per `lookup` call.
 *   MCP_FIXTURE_DESC      — override the `lookup` description (E3 quarantine).
 *   MCP_FIXTURE_CRASH=1   — exit(1) immediately before connecting (E4).
 *
 * No new dependency: `@modelcontextprotocol/sdk` is a direct dependency of
 * `@voidrift/core` (the MCP SDK is the core's MCP substrate) and already in the
 * tree for the CLI's own use.
 */
import { appendFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

if (process.env.MCP_FIXTURE_CRASH === "1") {
  // E4 — a server that crashes at start. Exit non-zero before the handshake so
  // the host records status `error` and the run completes (non-fatal, no hang).
  process.stderr.write("mcp-stdio-fixture: intentional startup crash\n");
  process.exit(1);
}

const callLog = process.env.MCP_FIXTURE_CALLLOG;
const description = process.env.MCP_FIXTURE_DESC ?? "Look up a record by id (read-only).";

const server = new McpServer({ name: "fixture", version: "0.0.1" });

server.registerTool(
  "lookup",
  {
    description,
    inputSchema: { id: z.string().optional() },
    annotations: { readOnlyHint: true, title: "Lookup" },
  },
  async (args) => {
    if (callLog) {
      try {
        appendFileSync(callLog, JSON.stringify({ at: Date.now(), args }) + "\n");
      } catch {
        /* best effort; the test reads the file, a write failure fails the test */
      }
    }
    return { content: [{ type: "text", text: `LOOKED_UP:${args?.id ?? ""}` }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
// Exit promptly when the parent closes our stdin (the SDK transport ends stdin
// on close): the McpServer does not exit the process on transport close by
// itself, so without this the child would linger after a parent shutdown and
// show up as an orphan. Covers both stdin 'end'/'close' and the transport's
// own onclose, whichever fires first.
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
transport.onclose = () => process.exit(0);
