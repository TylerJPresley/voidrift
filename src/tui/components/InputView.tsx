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
  const [lastCtrlC, setLastCtrlC] = useState(0);
  const { exit } = useApp();

  useInput((ch, key) => {
    // Double Ctrl+C to exit (4 second window)
    if (ch === "c" && key.ctrl) {
      const now = Date.now();
      if (now - lastCtrlC < 4000) { exit(); return; }
      setLastCtrlC(now);
      return;
    }
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

    // Input history / pending recall
    if (key.upArrow && !value) {
      // Recall queued message (REQ-UI-15)
      if (region.pendingMessage) {
        setValue(region.pendingMessage);
        region.setPending(null);
        return;
      }
      // History cycling
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

    // Queue if busy and no pending message yet
    if (region.busy && !region.pendingMessage) {
      region.setPending(text);
      setValue("");
      return;
    }
    if (region.busy) return; // Already queued, locked

    setValue("");
    setHistoryIdx(-1);
    region.pushHistory(text);
    if (text.toLowerCase() === "/quit" || text.toLowerCase() === "quit") { exit(); return; }
    onSubmit(text);
  }, [onSubmit, exit, region]);

  // Hidden when panel is active
  if (footer.hasPanel) return null;

  const ctrlCActive = Date.now() - lastCtrlC < 4000;
  const hasQueued = region.pendingMessage !== null;
  const locked = region.busy && hasQueued; // Lock after one queued message

  const placeholder = ctrlCActive
    ? "press Ctrl+C again to exit"
    : locked
    ? "message queued — ↑ to edit"
    : region.busy
    ? "voidrift is working — type a message to queue"
    : "ask a question or describe a task ↵";

  return (
    <Box>
      {!value && <Text dimColor italic>{placeholder}</Text>}
      {!locked && <TextInput value={value} onChange={setValue} onSubmit={handleSubmit} />}
    </Box>
  );
}
