/**
 * A tiny, typed, SCRIPTABLE OpenAI-compatible SSE server for end-to-end tests.
 *
 * It stands in for a real HTTP model (Ollama/vLLM/OpenAI proxy) so the BUILT
 * product's tool-call path runs against actual HTTP + SSE — the one path 1143
 * fake-driven unit tests never exercise. No new dependencies: `node:http` only.
 *
 * Scripting: push a SEQUENCE of replies with `script(...)`. The Nth
 * `POST /v1/chat/completions` consumes the Nth scripted reply:
 *   - `{ text }` streams the text split across 2-3 content chunks, then a final
 *     usage chunk and `[DONE]`.
 *   - `{ toolCalls }` streams `delta.tool_calls` whose `function.arguments` is
 *     SPLIT across 2-3 chunks (the real wire shape that broke chunk assembly in
 *     production), finishing with `finish_reason: "tool_calls"`.
 * Every stream emits `role: "assistant"` in the first delta (Ollama/vLLM do),
 * a final usage chunk, and the terminating `[DONE]`. Each request body is
 * recorded on `requests` so a test can assert what the PRODUCT actually sent
 * (message roles, bound tool names, tool-result messages).
 *
 * It listens on port 0 (an ephemeral port) and is bound to 127.0.0.1 so it is
 * never reachable off-box. `close()` shuts it down; the test harness calls it
 * in `afterAll`/`afterEach` so no server is ever left running.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

/** A scripted reply: streamed text, a batch of tool calls, a tool call whose
 * raw `arguments` string is emitted verbatim (so a test can inject malformed
 * JSON), a mid-stream connection drop, or a non-2xx HTTP error response. */
export type ScriptedReply =
  | { text: string }
  | { toolCalls: Array<{ name: string; args: unknown }> }
  | { rawToolCall: { name: string; rawArgs: string } }
  | { dropAfterChunks: number }
  | { httpStatus: number; errorBody?: unknown };

/** The recorded shape of one request the product sent. */
export interface RecordedRequest {
  /** The parsed JSON body (OpenAI chat-completions request). */
  body: {
    model?: string;
    stream?: boolean;
    messages?: Array<{ role?: string; content?: unknown; tool_call_id?: string }>;
    tools?: Array<{ type?: string; function?: { name?: string } }>;
    [k: string]: unknown;
  };
  /** The message roles in order, for quick assertions. */
  roles: string[];
  /** The bound tool names (from `tools[].function.name`), in order. */
  toolNames: string[];
}

/** A running fake server handle. */
export interface FakeOpenAI {
  /** The base URL to put in config `models.<name>.baseUrl` (ends in `/v1`). */
  url: string;
  /** Every recorded chat-completions request, in arrival order. */
  requests: RecordedRequest[];
  /** Replace the scripted reply sequence; the next request consumes index 0. */
  script: (...replies: ScriptedReply[]) => void;
  /** Append to the scripted reply sequence. */
  push: (...replies: ScriptedReply[]) => void;
  /** Reply with this to EVERY request (an endless-loop driver); overrides the
   * scripted sequence until cleared with `clearAlways()`. */
  always: (reply: ScriptedReply) => void;
  /** Clear a previously-set `always` reply. */
  clearAlways: () => void;
  /** Stop the server and release the port. Idempotent. */
  close: () => Promise<void>;
}

/** Serialize one SSE `data:` frame for an OpenAI chat-completion chunk. */
function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** A process-wide monotonic tool-call id source. Each emitted tool call gets a
 * UNIQUE id so a model that repeats the same call never collides on a
 * `tool_call_id` the runtime already resolved — otherwise a scripted endless
 * loop would be falsely treated as answered and stop early. */
let callIdSeq = 0;
function nextCallId(): number {
  callIdSeq += 1;
  return callIdSeq;
}

/** Split a string into `n` roughly-equal, non-empty pieces (n clamped 2..3). */
function splitInto(s: string, n: number): string[] {
  const parts = Math.min(3, Math.max(2, n));
  if (s.length === 0) return ["", ""];
  const size = Math.ceil(s.length / parts);
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  while (out.length < 2) out.push("");
  return out;
}

/** The reply variants `framesFor` renders as a full SSE stream. */
type StreamReply = { text: string } | { toolCalls: Array<{ name: string; args: unknown }> } | { rawToolCall: { name: string; rawArgs: string } };

/** Build the chunk frames for a scripted reply. */
function framesFor(reply: StreamReply, model: string): string[] {
  const base = {
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: 0,
    model,
  };
  const frames: string[] = [];
  // First delta always carries role:"assistant" (Ollama/vLLM do this).
  if ("text" in reply) {
    const pieces = splitInto(reply.text, 3);
    pieces.forEach((piece, i) => {
      frames.push(
        sse({
          ...base,
          choices: [
            {
              index: 0,
              delta: i === 0 ? { role: "assistant", content: piece } : { content: piece },
              finish_reason: null,
            },
          ],
        }),
      );
    });
    frames.push(
      sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }),
    );
  } else if ("rawToolCall" in reply) {
    // A single tool call whose `arguments` string is emitted VERBATIM — the
    // test supplies malformed/truncated JSON to exercise the parse path.
    frames.push(
      sse({
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      }),
    );
    frames.push(
      sse({
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call_${nextCallId()}`,
                  type: "function",
                  function: { name: reply.rawToolCall.name, arguments: reply.rawToolCall.rawArgs },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }),
    );
    frames.push(
      sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    );
  } else {
    // Tool calls: emit role first, then split each call's arguments across
    // 2-3 deltas so the product must assemble them (the production-bug path).
    frames.push(
      sse({
        ...base,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      }),
    );
    reply.toolCalls.forEach((call, index) => {
      const id = `call_${nextCallId()}`;
      const argStr = JSON.stringify(call.args ?? {});
      const argPieces = splitInto(argStr, 3);
      // First delta for this call carries id + function.name + first arg slice.
      frames.push(
        sse({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    id,
                    type: "function",
                    function: { name: call.name, arguments: argPieces[0] ?? "" },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      );
      // Remaining arg slices carry only the arguments continuation.
      for (let p = 1; p < argPieces.length; p++) {
        frames.push(
          sse({
            ...base,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index, function: { arguments: argPieces[p] } }] },
                finish_reason: null,
              },
            ],
          }),
        );
      }
    });
    frames.push(
      sse({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] }),
    );
  }
  // A final usage chunk (OpenAI streams this when stream_options.include_usage).
  frames.push(
    sse({
      ...base,
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
    }),
  );
  frames.push("data: [DONE]\n\n");
  return frames;
}

/**
 * Build a single non-streaming OpenAI chat completion (the `stream:false`
 * shape a real server returns). Mirrors `framesFor` for the three reply
 * variants: text, tool calls, and a raw tool call. The `.invoke()` path a
 * dispatched worker uses consumes this (not SSE).
 */
function jsonCompletion(reply: StreamReply, model: string): unknown {
  const base = { id: "chatcmpl-fake", object: "chat.completion", created: 0, model };
  const usage = { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 };
  if ("text" in reply) {
    return {
      ...base,
      choices: [{ index: 0, message: { role: "assistant", content: reply.text }, finish_reason: "stop" }],
      usage,
    };
  }
  const calls =
    "rawToolCall" in reply
      ? [{ name: reply.rawToolCall.name, arguments: reply.rawToolCall.rawArgs }]
      : reply.toolCalls.map((c) => ({ name: c.name, arguments: JSON.stringify(c.args ?? {}) }));
  return {
    ...base,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: "",
          tool_calls: calls.map((c) => ({
            id: `call_${nextCallId()}`,
            type: "function",
            function: { name: c.name, arguments: c.arguments },
          })),
        },
        finish_reason: "tool_calls",
      },
    ],
    usage,
  };
}

/** Start the fake server on an ephemeral localhost port. */
export async function startFakeOpenAI(initial: ScriptedReply[] = []): Promise<FakeOpenAI> {
  const requests: RecordedRequest[] = [];
  let replies: ScriptedReply[] = [...initial];
  let consumed = 0;
  let alwaysReply: ScriptedReply | null = null;

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    if (req.method === "GET" && url.startsWith("/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "fake", object: "model" }] }));
      return;
    }
    if (req.method === "POST" && url.startsWith("/v1/chat/completions")) {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        let body: RecordedRequest["body"] = {};
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as RecordedRequest["body"];
        } catch {
          body = {};
        }
        const roles = (body.messages ?? []).map((m) => String(m.role ?? ""));
        const toolNames = (body.tools ?? [])
          .map((t) => t.function?.name)
          .filter((n): n is string => typeof n === "string");
        requests.push({ body, roles, toolNames });

        const reply: ScriptedReply = alwaysReply ?? replies[consumed] ?? { text: "" };
        if (alwaysReply === null) consumed += 1;
        const model = typeof body.model === "string" ? body.model : "fake";

        // Non-2xx HTTP error (H7): a JSON error body, no SSE stream.
        if ("httpStatus" in reply) {
          res.writeHead(reply.httpStatus, { "content-type": "application/json" });
          res.end(JSON.stringify(reply.errorBody ?? { error: { message: `fake ${reply.httpStatus}` } }));
          return;
        }

        // Non-streaming request (`stream !== true`): a REAL OpenAI-compatible
        // server returns a single JSON completion, not SSE. A dispatched worker
        // calls the model with `.invoke()` (stream:false), so the worker-gate
        // path exercises this branch. `dropAfterChunks` is streaming-only.
        if (body.stream !== true && !("dropAfterChunks" in reply)) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify(jsonCompletion(reply, model)));
          return;
        }

        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });

        // Mid-stream connection drop (H6): write N content chunks then DESTROY
        // the socket before `[DONE]`, so the client sees a truncated stream.
        if ("dropAfterChunks" in reply) {
          const n = Math.max(0, reply.dropAfterChunks);
          const base = { id: "chatcmpl-fake", object: "chat.completion.chunk", created: 0, model };
          res.write(sse({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }));
          for (let i = 0; i < n; i++) {
            res.write(sse({ ...base, choices: [{ index: 0, delta: { content: `part${i} ` }, finish_reason: null }] }));
          }
          // Destroy the underlying socket WITHOUT ending the stream or sending
          // `[DONE]` — a hard mid-stream drop.
          req.destroy();
          res.destroy();
          return;
        }

        for (const frame of framesFor(reply, model)) res.write(frame);
        res.end();
      });
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  let closed = false;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    requests,
    script: (...r: ScriptedReply[]): void => {
      replies = [...r];
      consumed = 0;
      alwaysReply = null;
    },
    push: (...r: ScriptedReply[]): void => {
      replies.push(...r);
    },
    always: (r: ScriptedReply): void => {
      alwaysReply = r;
    },
    clearAlways: (): void => {
      alwaysReply = null;
    },
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
