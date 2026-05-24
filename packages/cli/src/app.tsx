import React, { useState, useCallback } from "react";
import { render, Box, Text, Static, useApp } from "ink";
import TextInput from "ink-text-input";
import { loadConfig } from "./config/loader.js";
import { createAdapter } from "./adapters/factory.js";
import { SessionManager } from "./session/manager.js";

const { model, modelName } = loadConfig();
const adapter = createAdapter(model);
const session = new SessionManager(adapter);

interface HistoryEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
}

function App() {
  const { exit } = useApp();
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [streaming, setStreaming] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  let nextId = history.length;

  const handleSubmit = useCallback(async (text: string) => {
    if (!text.trim() || busy) return;
    setInput("");
    if (text.trim() === "/exit") { exit(); return; }

    const userEntry: HistoryEntry = { id: String(nextId++), role: "user", text: text.trim() };
    setHistory(h => [...h, userEntry]);
    setBusy(true);
    setStreaming("");

    let acc = "";
    for await (const chunk of session.send(text.trim())) {
      if (chunk.content) {
        acc += chunk.content;
        setStreaming(acc);
      }
    }

    setHistory(h => [...h, { id: String(nextId++), role: "assistant", text: acc }]);
    setStreaming("");
    setBusy(false);
  }, [busy]);

  return (
    <Box flexDirection="column">
      <Text color="#6a7ec8" bold>voidrift</Text>
      <Text dimColor>{modelName} · {model.base_url}</Text>
      <Text> </Text>

      <Static items={history}>
        {(entry) => (
          <Box key={entry.id} flexDirection="column">
            {entry.role === "user"
              ? <Text><Text color="#6a7ec8">┃ </Text><Text bold>{entry.text}</Text></Text>
              : <Text><Text color="#6a7ec8">┃ </Text>{entry.text}</Text>
            }
          </Box>
        )}
      </Static>

      {streaming && (
        <Box flexDirection="column">
          <Text><Text color="#6a7ec8">┃ </Text>{streaming}<Text color="#6a7ec8">▊</Text></Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="#6a7ec8" bold>❯ </Text>
        {busy
          ? <Text dimColor>streaming...</Text>
          : <TextInput value={input} onChange={setInput} onSubmit={handleSubmit} placeholder="message" />
        }
      </Box>
    </Box>
  );
}

render(<App />);
