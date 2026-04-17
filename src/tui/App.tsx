import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import type { TUIState, TUIMessage } from "./state.js";
import { Header } from "./Header.js";
import { Footer } from "./Footer.js";
import { Message } from "./Message.js";
import { Thinking } from "./Thinking.js";
import { Panel } from "./Panel.js";
import { closePanel } from "./state.js";

interface AppProps {
  state: TUIState;
  onSubmit: (text: string) => void;
  onEscape?: () => void;
}

export function App({ state, onSubmit, onEscape }: AppProps) {
  const [input, setInput] = useState("");
  const [, forceUpdate] = useState(0);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [savedInput, setSavedInput] = useState("");
  const { exit } = useApp();

  // Subscribe to state mutations
  useEffect(() => {
    state._notify = () => forceUpdate(v => v + 1);
    return () => { state._notify = undefined; };
  }, [state]);

  useInput((ch, key) => {
    // Panel key handling — intercept when panel is open
    if (state.panel) {
      if (key.escape) { state.panel.onCancel?.(); closePanel(state); return; }
      if (key.upArrow) {
        state.panel.selectedIndex = Math.max(0, state.panel.selectedIndex - 1);
        state._notify?.();
        return;
      }
      if (key.downArrow) {
        state.panel.selectedIndex = Math.min(state.panel.items.length - 1, state.panel.selectedIndex + 1);
        state._notify?.();
        return;
      }
      if (key.return) {
        const item = state.panel.items[state.panel.selectedIndex];
        if (item) { state.panel.onSelect?.(item); closePanel(state); }
        return;
      }
      return; // Swallow all other keys while panel is open
    }

    if (key.escape) {
      onEscape?.();
      return;
    }
    // Input history cycling (REQ-UI-16)
    if (key.upArrow && !input) {
      // Pending message recall takes priority (REQ-UI-15)
      if (state.pendingMessage) return;
      if (!state.inputHistory.length) return;
      if (historyIdx === -1) setSavedInput(input);
      const newIdx = Math.min(historyIdx + 1, state.inputHistory.length - 1);
      setHistoryIdx(newIdx);
      setInput(state.inputHistory[state.inputHistory.length - 1 - newIdx]);
      return;
    }
    if (key.downArrow && historyIdx >= 0) {
      const newIdx = historyIdx - 1;
      if (newIdx < 0) { setHistoryIdx(-1); setInput(savedInput); return; }
      setHistoryIdx(newIdx);
      setInput(state.inputHistory[state.inputHistory.length - 1 - newIdx]);
      return;
    }
  });

  const handleSubmit = useCallback((value: string) => {
    const text = value.trim();
    if (!text) return;
    setInput("");
    setHistoryIdx(-1);
    state.inputHistory.push(text);

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
      </Box>

      {/* Panel (collapsible) */}
      {state.panel && <Panel panel={state.panel} />}

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
