import React, { useState, useEffect } from "react";
import { Text } from "ink";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface ThinkingProps {
  label?: string;
}

export function Thinking({ label = "thinking..." }: ThinkingProps) {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % SPINNER.length), 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text color="#e5c07b">  {SPINNER[frame]} {label}</Text>
  );
}
