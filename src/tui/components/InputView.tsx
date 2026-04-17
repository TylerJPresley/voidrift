import React, { useState, useCallback } from "react";
import { Box, Text, useInput, useApp } from "ink";
import TextInput from "ink-text-input";
import type { InputRegion } from "../regions/InputRegion.js";
import type { FooterRegion } from "../regions/FooterRegion.js";
import { useRegion } from "../useRegion.js";

interface InputViewProps {
  input: InputRegion;
  footer: FooterRegion;
  onSubmit: (text: string) => void;
  onEscape: () => void;
}

export function InputView({ input: region, footer, onSubmit, onEscape }: InputViewProps) {
  useRegion(region);
  useRegion(footer);
  const [value, setValue] = useState("");
  const [historyIdx, setHistoryIdx] = useState(-1);
  const [savedInput, setSavedInput] = useState("");
  const { exit } = useApp();

  useInput((ch, key) => {
    // Panel mode — intercept keys for footer panel
    if (footer.panel) {
      if (key.escape) { footer.panel.onCancel(); footer.closePanel(); return; }
      if (key.leftArrow || key.upArrow) {
        footer.panel.selectedIndex = Math.max(0, footer.panel.selectedIndex - 1);
        footer["emit"](); // trigger re-render
        return;
      }
      if (key.rightArrow || key.downArrow) {
        footer.panel.selectedIndex = Math.min(footer.panel.items.length - 1, footer.panel.selectedIndex + 1);
        footer["emit"]();
        return;
      }
      if (key.return) {
        const item = footer.panel.items[footer.panel.selectedIndex];
        if (item) { footer.panel.onSelect(item); footer.closePanel(); }
        return;
      }
      return;
    }

    // Ctrl+J — insert newline (REQ-UI-3)
    if (ch === "\x0A" || (ch === "j" && key.ctrl)) {
      setValue(v => v + "\n");
      return;
    }

    if (key.escape) { onEscape(); return; }

    // Input history
    if (key.upArrow && !value) {
      if (region.pendingMessage) return;
      if (!region.history.length) return;
      if (historyIdx === -1) setSavedInput(value);
      const idx = Math.min(historyIdx + 1, region.history.length - 1);
      setHistoryIdx(idx);
      setValue(region.history[region.history.length - 1 - idx]);
      return;
    }
    if (key.downArrow && historyIdx >= 0) {
      const idx = historyIdx - 1;
      if (idx < 0) { setHistoryIdx(-1); setValue(savedInput); return; }
      setHistoryIdx(idx);
      setValue(region.history[region.history.length - 1 - idx]);
      return;
    }
  });

  const handleSubmit = useCallback((v: string) => {
    // Backslash at end of line = insert newline, don't submit (REQ-UI-3)
    if (v.endsWith("\\")) {
      setValue(v.slice(0, -1) + "\n");
      return;
    }
    const text = v.trim();
    if (!text) return;
    setValue("");
    setHistoryIdx(-1);
    region.pushHistory(text);
    if (text.toLowerCase() === "/quit" || text.toLowerCase() === "quit") { exit(); return; }
    onSubmit(text);
  }, [onSubmit, exit, region]);

  // Hidden when panel is active
  if (footer.hasPanel) return null;

  const placeholder = region.busy
    ? (region.mode ? "command running · /ask for questions" : "voidrift is working · type to queue a message")
    : "ask a question or describe a task ↵";

  return (
    <Box>
      {value || region.busy ? null : <Text dimColor italic>{placeholder}</Text>}
      {value || !region.busy ? <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} /> : null}
    </Box>
  );
}
