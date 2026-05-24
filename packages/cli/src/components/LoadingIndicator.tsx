import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

const PHRASES = [
  "Thinking...",
  "Analyzing the problem...",
  "Reading context...",
  "Formulating response...",
  "Considering approaches...",
  "Connecting the dots...",
  "Processing...",
  "Reasoning...",
];

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function LoadingIndicator({ startTime }: { startTime: number }) {
  const [frame, setFrame] = useState(0);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => {
      setFrame(f => (f + 1) % SPINNER_FRAMES.length);
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 80);
    return () => clearInterval(t);
  }, [startTime]);

  useEffect(() => {
    const t = setInterval(() => setPhraseIdx(i => (i + 1) % PHRASES.length), 5000);
    return () => clearInterval(t);
  }, []);

  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

  return (
    <Box paddingLeft={2} marginTop={1}>
      <Text color="#6a7ec8">{SPINNER_FRAMES[frame]} </Text>
      <Text color="#4ec9b0">{PHRASES[phraseIdx]}</Text>
      <Text dimColor>  ({elapsedStr} · esc to cancel)</Text>
    </Box>
  );
}
