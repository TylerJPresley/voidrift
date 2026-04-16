import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import type { TUIState, TUIMessage } from "./state.js";
import { Header } from "./Header.js";
import { Footer } from "./Footer.js";
import { Message } from "./Message.js";
import { Thinking } from "./Thinking.js";

interface AppProps {
  state: TUIState;
  onSubmit: (text: string) => void;
  onEscape?: () => void;
}

export function App({ state, onSubmit, onEscape }: AppProps) {
  const [input, setInput] = useState("");
  const [, forceUpdate] = useState(0);
  const { exit } = useApp();

  // Subscribe to state mutations
  useEffect(() => {
    state._notify = () => forceUpdate(v => v + 1);
    return () => { state._notify = undefined; };
  }, [state]);

  useInput((ch, key) => {
    if (key.escape) {
      onEscape?.();
      return;
    }
  });

  const handleSubmit = useCallback((value: string) => {
    const text = value.trim();
    if (!text) return;
    setInput("");

    if (text.toLowerCase() === "/quit" || text.toLowerCase() === "quit") {
      exit();
      return;
    }

    onSubmit(text);
  }, [onSubmit, exit]);

  const placeholder = state.busy
    ? (state.mode ? "command running · /ask for questions" : "voidrift is working · type to queue a message")
    : "ask a question or describe a task ↵";

  return (
    <Box flexDirection="column" height="100%">
      {/* Conversation area */}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        <Header modelName={state.modelName} hasMessages={state.messages.length > 0} />
        {state.messages.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}
        {state.thinking && <Thinking label={state.thinkingLabel} />}
        <Text> </Text>
        <Text> </Text>
      </Box>

      {/* Separator */}
      <Text dimColor>{"─".repeat(process.stdout.columns || 80)}</Text>

      {/* Footer */}
      <Footer
        modelName={state.modelName}
        contextPct={state.contextPct}
        mode={state.mode}
        cwd={state.cwd}
        branch={state.branch}
      />

      {/* Spacer */}
      <Text> </Text>

      {/* Input */}
      <Box>
        {input || state.busy ? null : <Text dimColor italic>{placeholder}</Text>}
        {input || !state.busy ? (
          <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} />
        ) : null}
      </Box>
    </Box>
  );
}
