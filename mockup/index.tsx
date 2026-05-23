import React from "react";
import { render, Box, Text, Static, Newline } from "ink";

// ─── Fake Data ───────────────────────────────────────────────────────────────

const HISTORY = [
  {
    id: "1",
    type: "user" as const,
    text: "Read the main config file and explain what each section does.",
  },
  {
    id: "2",
    type: "tools" as const,
    tools: [
      {
        name: "read_file",
        args: 'path: "src/config.ts"',
        status: "success" as const,
        result: "export const config = {\n  model: 'qwen2.5-coder-32b',\n  protocol: 'openai',\n  ...\n}",
        elapsed: "0.2s",
      },
    ],
  },
  {
    id: "3",
    type: "assistant" as const,
    model: "qwen2.5-coder-32b",
    text: `The config file has three sections:

**model** — The model identifier sent to the API endpoint.
**protocol** — Which adapter to use (openai, anthropic, or gemini).
**base_url** — The endpoint URL for the model API.

Each section maps directly to the adapter factory in \`src/adapters/\`.`,
  },
  {
    id: "4",
    type: "user" as const,
    text: "Now update the config to add a timeout field with a default of 30s.",
  },
  {
    id: "5",
    type: "tools" as const,
    tools: [
      {
        name: "edit_file",
        args: 'path: "src/config.ts"',
        status: "success" as const,
        result: "+ timeout: 30_000, // 30s default",
        elapsed: "0.1s",
      },
      {
        name: "edit_file",
        args: 'path: "src/types.ts"',
        status: "success" as const,
        result: "+ timeout: number;",
        elapsed: "0.1s",
      },
    ],
  },
];

const STREAMING = {
  model: "qwen2.5-coder-32b",
  text: "Done. I added a `timeout` field to both the config object and the type definition. The default is 30 seconds (30,000ms). The adapter factory will need to pass this through to",
  elapsed: "3s",
  tokens: 42,
};

const FOOTER = {
  mode: "chat",
  product: "voidrift",
  model: "qwen2.5-coder-32b",
  contextPct: 24,
  tokens: "4.2k",
  branch: "feat/tui-mockup",
};

// ─── Components ──────────────────────────────────────────────────────────────

function UserMessage({ text }: { text: string }) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="blue">
        {"❯ "}
        <Text bold color="white">{text}</Text>
      </Text>
    </Box>
  );
}

function ToolGroup({ tools }: { tools: typeof HISTORY[1] extends { tools: infer T } ? T : never }) {
  return (
    <Box flexDirection="column" marginLeft={2} marginTop={1}>
      <Box borderStyle="single" borderColor="gray" flexDirection="column" paddingX={1}>
        {(tools as any[]).map((tool, i) => (
          <Box key={i} flexDirection="column">
            <Text>
              <Text color="green">✓</Text>
              <Text bold> {tool.name}</Text>
              <Text dimColor> ({tool.args})</Text>
              <Text dimColor> · {tool.elapsed}</Text>
            </Text>
            <Box marginLeft={2}>
              <Text dimColor>{tool.result}</Text>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function AssistantMessage({ model, text }: { model: string; text: string }) {
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      <Text dimColor italic>
        {model}
      </Text>
      <Text>{text}</Text>
    </Box>
  );
}

function StreamingMessage({
  model,
  text,
  elapsed,
  tokens,
}: {
  model: string;
  text: string;
  elapsed: string;
  tokens: number;
}) {
  return (
    <Box flexDirection="column" marginTop={1} marginLeft={2}>
      <Text dimColor italic>
        {model}
      </Text>
      <Text>{text}</Text>
      <Text color="yellow">▊</Text>
      <Box marginTop={1}>
        <Text dimColor>
          ⠹ {elapsed} · {tokens} tokens
        </Text>
      </Box>
    </Box>
  );
}

function Footer({
  mode,
  product,
  model,
  contextPct,
  tokens,
  branch,
}: typeof FOOTER) {
  const ctxColor = contextPct < 50 ? "green" : contextPct < 80 ? "yellow" : "red";
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} justifyContent="space-between">
      <Text>
        <Text color="cyan">[{mode}]</Text>
        <Text> {product}</Text>
        <Text dimColor> · </Text>
        <Text>{model}</Text>
      </Text>
      <Text>
        <Text color={ctxColor}>{contextPct}%</Text>
        <Text dimColor> · </Text>
        <Text>🛡 {tokens}</Text>
        <Text dimColor> · </Text>
        <Text color="magenta">{branch}</Text>
      </Text>
    </Box>
  );
}

function InputPrompt() {
  return (
    <Box marginTop={0}>
      <Text color="blue" bold>
        {"❯ "}
      </Text>
      <Text dimColor>Type a message...</Text>
    </Box>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  return (
    <Box flexDirection="column">
      {/* Static history */}
      <Static items={HISTORY}>
        {(item) => {
          if (item.type === "user") {
            return <UserMessage key={item.id} text={item.text} />;
          }
          if (item.type === "tools") {
            return <ToolGroup key={item.id} tools={(item as any).tools} />;
          }
          if (item.type === "assistant") {
            return (
              <AssistantMessage
                key={item.id}
                model={(item as any).model}
                text={(item as any).text}
              />
            );
          }
          return null;
        }}
      </Static>

      {/* Active streaming response */}
      <StreamingMessage
        model={STREAMING.model}
        text={STREAMING.text}
        elapsed={STREAMING.elapsed}
        tokens={STREAMING.tokens}
      />

      {/* Footer + Input */}
      <Box flexDirection="column" marginTop={1}>
        <Footer {...FOOTER} />
        <InputPrompt />
      </Box>
    </Box>
  );
}

render(<App />);
