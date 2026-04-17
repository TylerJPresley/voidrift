import React, { useState, useEffect } from "react";
import { Text } from "ink";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const DEFAULTS = ["Thinking", "Pondering", "Ruminating", "Cogitating", "Deliberating",
  "Contemplating", "Percolating", "Musing", "Tinkering", "Divining"];

function loadLabels(): string[] {
  try {
    const lines = readFileSync(join(homedir(), ".voidrift", "spinner-labels.txt"), "utf-8")
      .split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    return lines.length ? lines : DEFAULTS;
  } catch { return DEFAULTS; }
}

const labels = loadLabels();

export function randomLabel(): string {
  return `${labels[Math.floor(Math.random() * labels.length)]}...`;
}

export function Thinking({ label }: { label?: string }) {
  const [frame, setFrame] = useState(0);
  const [text] = useState(() => label ?? randomLabel());

  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text color="#e5c07b">  {SPINNER[frame]} {text}</Text>
  );
}
