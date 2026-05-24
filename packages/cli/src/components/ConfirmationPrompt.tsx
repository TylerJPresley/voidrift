import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ConfirmResult } from "../tools/registry.js";

interface ConfirmationPromptProps {
  toolName: string;
  keyArg: string;
  args: Record<string, unknown>;
  onRespond: (result: ConfirmResult) => void;
}

const OPTIONS: { label: string; value: ConfirmResult; hint?: string }[] = [
  { label: "Yes, allow once", value: "allow" },
  { label: "Always allow this tool", value: "always", hint: "for this session" },
  { label: "No, deny", value: "deny", hint: "esc" },
];

function renderPreview(toolName: string, args: Record<string, unknown>): React.ReactNode {
  switch (toolName) {
    case "bash":
      return (
        <Box marginLeft={2} marginY={1}>
          <Text color="#abb2bf">$ </Text>
          <Text bold>{String(args.command || "")}</Text>
        </Box>
      );
    case "write":
      return (
        <Box flexDirection="column" marginLeft={2} marginY={1}>
          <Text dimColor>Write to: </Text>
          <Text color="#61afef">{String(args.path || "")}</Text>
          <Text dimColor> ({String(args.content || "").split("\n").length} lines)</Text>
        </Box>
      );
    case "edit":
      return (
        <Box flexDirection="column" marginLeft={2} marginY={1}>
          <Text color="#61afef">{String(args.path || "")}</Text>
          {args.old_text && (
            <Box flexDirection="column" marginLeft={1}>
              <Text color="red">- {String(args.old_text).split("\n").slice(0, 3).join("\n- ")}</Text>
              <Text color="green">+ {String(args.new_text || "").split("\n").slice(0, 3).join("\n+ ")}</Text>
            </Box>
          )}
        </Box>
      );
    default:
      return (
        <Box marginLeft={2} marginY={1}>
          <Text dimColor>{JSON.stringify(args, null, 2).slice(0, 200)}</Text>
        </Box>
      );
  }
}

export function ConfirmationPrompt({ toolName, keyArg, args, onRespond }: ConfirmationPromptProps) {
  const [selected, setSelected] = useState(0);

  useInput((_, key) => {
    if (key.upArrow) setSelected(s => Math.max(0, s - 1));
    if (key.downArrow) setSelected(s => Math.min(OPTIONS.length - 1, s + 1));
    if (key.return) onRespond(OPTIONS[selected].value);
    if (key.escape) onRespond("deny");
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="#e5c07b" paddingX={1} marginLeft={1} marginTop={1}>
      <Box>
        <Text color="yellow">? </Text>
        <Text bold>{toolName}</Text>
        <Text dimColor>  {keyArg}</Text>
      </Box>

      {renderPreview(toolName, args)}

      <Box flexDirection="column" marginTop={1}>
        {OPTIONS.map((opt, i) => (
          <Box key={i}>
            <Text color={i === selected ? "#4ec9b0" : "gray"}>
              {i === selected ? "● " : "○ "}
            </Text>
            <Text color={i === selected ? "#4ec9b0" : undefined} bold={i === selected}>
              {opt.label}
            </Text>
            {opt.hint && <Text dimColor>  ({opt.hint})</Text>}
          </Box>
        ))}
      </Box>
    </Box>
  );
}
